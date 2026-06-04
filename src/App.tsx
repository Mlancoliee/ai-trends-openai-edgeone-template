import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode, SVGProps } from 'react';
import { fetchHistory, fetchLatest, fetchReportDetail, runReportSSE, stopReport, deleteReport } from './api';
import MarkdownReport from './MarkdownReport';
import { EMPTY_REPORT, normalizeReport } from './reportModel';
import type { AnalystCategoryEvent, AnalystDeepDiveEvent, HistoryEntry, ItemPhase, PipelineEvent, TrendItem, TrendReport } from './types';
import styles from './App.module.css';

function formatTime(value?: string): string {
  if (!value) return '尚未生成';
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

function StatusPill({ status }: { status?: string }) {
  const normalized = status || 'empty';
  const labels: Record<string, string> = {
    empty: '待生成',
    running: '生成中',
    success: '已完成',
    failed: '失败',
  };
  return <span className={`${styles.status} ${styles[`status_${normalized}`] ?? ''}`}>{labels[normalized] ?? normalized}</span>;
}

function itemSummary(item?: TrendItem): string {
  if (!item) return '';
  return item.aiSummary?.trim() || item.summary?.trim() || `${item.category || 'AI'} 动态：${item.title}。`;
}

function formatItemTime(value?: string): string {
  if (!value) return '未知时间';
  return formatTime(value);
}

const TOPICS = ['AI Agent', 'LLM', 'Multimodal', 'Open Source Model', 'AI Infra'];
const DEFAULT_SOURCES = ['Hacker News', 'Dev.to'];

const PIPELINE_STAGES = [
  { key: 'fetch', label: 'Fetch', labelCn: '采集' },
  { key: 'filter', label: 'Filter & Summarize', labelCn: '筛选 & 摘要', parallel: ['curator', 'summarizer'] },
  { key: 'analyst', label: 'Analyze', labelCn: '分析' },
  { key: 'writer', label: 'Write', labelCn: '撰写' },
] as const;

type StageStatus = 'pending' | 'running' | 'done' | 'failed' | 'skipped';

interface StageState {
  status: StageStatus;
  duration?: number;
  detail?: string;
}

/* ====================================
   Live Item Model (during generation)
   ==================================== */
interface LiveItem extends TrendItem {
  _phase?: ItemPhase;
  _categoryAssigned?: string;
  _categoryStatus?: 'new' | 'active' | 'single';
  _importance?: 'high' | 'medium' | 'low';
  _dropping?: boolean;
}

type LivePhase = 'idle' | 'fetched' | 'curated' | 'summarized' | 'analyzed' | 'writing' | 'done';

/* ====================================
   Inline SVG Icons (Lucide-style)
   ==================================== */
type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function Icon({ children, size = 16, ...rest }: IconProps & { children: ReactNode }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      {children}
    </svg>
  );
}

const IconCheck = (p: IconProps) => (
  <Icon {...p}><polyline points="20 6 9 17 4 12" /></Icon>
);
const IconX = (p: IconProps) => (
  <Icon {...p}><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></Icon>
);
const IconSparkle = (p: IconProps) => (
  <Icon {...p}><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1" /></Icon>
);
const IconHistory = (p: IconProps) => (
  <Icon {...p}><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5" /><path d="M12 7v5l3 2" /></Icon>
);
const IconRefresh = (p: IconProps) => (
  <Icon {...p}><path d="M21 12a9 9 0 0 1-15 6.7L3 16" /><path d="M3 12a9 9 0 0 1 15-6.7L21 8" /><path d="M21 3v5h-5" /><path d="M3 21v-5h5" /></Icon>
);
const IconTrendingUp = (p: IconProps) => (
  <Icon {...p}><polyline points="3 17 9 11 13 15 21 7" /><polyline points="14 7 21 7 21 14" /></Icon>
);
const IconPlay = (p: IconProps) => (
  <Icon {...p}><polygon points="6 4 20 12 6 20 6 4" /></Icon>
);
const IconStop = (p: IconProps) => (
  <Icon {...p}><rect x="6" y="6" width="12" height="12" rx="2" /></Icon>
);
const IconBookmark = (p: IconProps) => (
  <Icon {...p}><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" /></Icon>
);
const IconArrowRight = (p: IconProps) => (
  <Icon {...p}><line x1="5" y1="12" x2="19" y2="12" /><polyline points="12 5 19 12 12 19" /></Icon>
);
const IconExternal = (p: IconProps) => (
  <Icon {...p}><path d="M15 3h6v6" /><path d="M10 14L21 3" /><path d="M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5" /></Icon>
);
const IconInbox = (p: IconProps) => (
  <Icon {...p}><polyline points="22 12 16 12 14 15 10 15 8 12 2 12" /><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" /></Icon>
);
const IconCompass = (p: IconProps) => (
  <Icon {...p}><circle cx="12" cy="12" r="10" /><polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76" /></Icon>
);
const IconLayers = (p: IconProps) => (
  <Icon {...p}><polygon points="12 2 2 7 12 12 22 7 12 2" /><polyline points="2 17 12 22 22 17" /><polyline points="2 12 12 17 22 12" /></Icon>
);
const IconDatabase = (p: IconProps) => (
  <Icon {...p}><ellipse cx="12" cy="5" rx="9" ry="3" /><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" /><path d="M3 12c0 1.66 4 3 9 3s9-1.34 9-3" /></Icon>
);
const IconClock = (p: IconProps) => (
  <Icon {...p}><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></Icon>
);

function TriggerBadge({ trigger }: { trigger?: string }) {
  if (trigger === 'schedule') {
    return <span className={styles.triggerBadge} data-trigger="schedule"><IconClock size={11} /> 定时</span>;
  }
  if (trigger === 'manual') {
    return <span className={styles.triggerBadge} data-trigger="manual"><IconPlay size={11} /> 手动</span>;
  }
  return null;
}

/* ====================================
   Pipeline Bar
   ==================================== */
function PipelineBar({
  stages,
}: {
  stages: Record<string, StageState>;
}) {
  // Compute merged stage status for parallel stages (curator + summarizer → filter)
  const getStageState = (def: typeof PIPELINE_STAGES[number]): StageState => {
    if ('parallel' in def && def.parallel) {
      const subs = def.parallel.map(k => stages[k] || { status: 'pending' as StageStatus });
      if (subs.every(s => s.status === 'done')) {
        const maxDur = Math.max(...subs.map(s => s.duration ?? 0));
        return { status: 'done', duration: maxDur };
      }
      if (subs.some(s => s.status === 'failed')) return { status: 'failed' };
      if (subs.some(s => s.status === 'running')) return { status: 'running' };
      return { status: 'pending' };
    }
    return stages[def.key] || { status: 'pending' as StageStatus };
  };

  // Nothing to show
  const hasAnyActivity = Object.keys(stages).length > 0;
  if (!hasAnyActivity) return null;

  return (
    <div className={styles.pipelineBar}>
      {PIPELINE_STAGES.map((def, i) => {
        const state = getStageState(def);
        const prevState = i > 0 ? getStageState(PIPELINE_STAGES[i - 1]) : null;
        return (
          <div key={def.key} className={styles.pipelineStageWrap}>
            {i > 0 && (
              <div className={`${styles.stageConnector} ${
                prevState && (prevState.status === 'done' || prevState.status === 'failed') ? styles.stageConnectorActive : ''
              }`} />
            )}
            <div className={`${styles.pipelineStage} ${styles[`stage_${state.status}`] || ''}`}>
              <div className={styles.stageDot}>
                {state.status === 'done' && <IconCheck size={14} />}
                {state.status === 'failed' && <IconX size={14} />}
                {state.status === 'running' && <span className={styles.stagePulse} />}
              </div>
              <div className={styles.stageInfo}>
                <span className={styles.stageName}>{def.labelCn}</span>
                {state.duration != null && (
                  <span className={styles.stageDuration}>{state.duration.toFixed(0)}s</span>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ====================================
   Live Feed (during generation)
   ==================================== */
const LIVE_PHASE_HINT: Record<LivePhase, string> = {
  idle: '准备开始...',
  fetched: '已采集到候选资讯，正在筛选 & 摘要...',
  curated: '已筛选有价值的内容，正在生成摘要...',
  summarized: '筛选 & 摘要完成，正在做趋势分析...',
  analyzed: '分析完成，正在撰写最终报告...',
  writing: '正在撰写报告，即将完成...',
  done: '报告已就绪',
};

function LiveFeed({
  items,
  phase,
  analysis,
}: {
  items: LiveItem[];
  phase: LivePhase;
  analysis: { categories: AnalystCategoryEvent[]; deepDives?: AnalystDeepDiveEvent[]; keyInsight?: string } | null;
}) {
  // Group items by analyst category once analysis arrives; otherwise show flat list.
  const grouped = useMemo(() => {
    if (!analysis || !analysis.categories?.length) return null;
    const byId = new Map(items.map(i => [i.id, i]));
    const result: Array<{ name: string; items: LiveItem[] }> = [];
    const used = new Set<string>();
    for (const cat of analysis.categories) {
      const catItems = cat.items
        .map(ci => byId.get(ci.id))
        .filter((x): x is LiveItem => !!x);
      catItems.forEach(it => used.add(it.id));
      if (catItems.length) result.push({ name: cat.name, items: catItems });
    }
    const orphans = items.filter(it => !used.has(it.id));
    if (orphans.length) result.push({ name: '其他', items: orphans });
    return result;
  }, [items, analysis]);

  return (
    <div className={styles.liveFeed}>
      <div className={styles.livePhaseBanner}>
        <span className={styles.livePhasePulse} />
        <span>{analysis?.keyInsight || LIVE_PHASE_HINT[phase]}</span>
      </div>

      {grouped ? (
        grouped.map(group => (
          <div key={group.name}>
            <div className={styles.feedGroupHeader}>
              <IconLayers />
              <span>{group.name}</span>
              <span className={styles.feedGroupBadge}>{group.items.length}</span>
            </div>
            {group.items.map(item => <LiveItemCard key={item.id} item={item} />)}
          </div>
        ))
      ) : (
        items.map(item => <LiveItemCard key={item.id} item={item} />)
      )}
    </div>
  );
}

function LiveItemCard({ item }: { item: LiveItem }) {
  const phaseClass =
    item._phase === 'summarized' ? styles.liveItemSummarized
      : item._phase === 'curated' ? styles.liveItemCurated
        : styles.liveItemFetched;
  const droppingClass = item._dropping ? styles.liveItemDropping : '';
  const importanceClass = item._importance === 'high' ? styles.liveItemHigh : '';
  return (
    <div className={`${styles.liveItemCard} ${phaseClass} ${droppingClass} ${importanceClass}`}>
      <div className={styles.newsMain}>
        <div className={styles.newsMetaTop}>
          <span className={styles.sourceBadge}>{item.source}</span>
          <span>{item.publishedAt ? formatTime(item.publishedAt) : ''}</span>
          {item._phase === 'fetched' && <span className={styles.livePhaseTag}>采集</span>}
          {item._phase === 'curated' && <span className={styles.livePhaseTagCurated}>已筛选</span>}
          {item._phase === 'summarized' && <span className={styles.livePhaseTagSummarized}>已摘要</span>}
          {item._categoryStatus === 'new' && <span className={styles.newBadge}>NEW</span>}
        </div>
        <strong>{item.title}</strong>
        {item._phase === 'summarized' && item.aiSummary && (
          <p className={styles.liveSummaryFadeIn}>{item.aiSummary}</p>
        )}
        {item._phase !== 'summarized' && item.summary && (
          <p style={{ opacity: 0.55 }}>{item.summary}</p>
        )}
      </div>
      <div className={styles.newsSideMeta}>
        <span>{item._categoryAssigned || item.category || 'AI'}</span>
        {item.score != null && <span>score {item.score}</span>}
      </div>
    </div>
  );
}

/* ====================================
   Mini Typing Card (sidebar, Writer streaming)
   ==================================== */
function MiniTypingCard({ text, onClick }: { text: string; onClick: () => void }) {
  // Show only the tail of the streaming text so the preview "rises" from the
  // bottom of the card as new tokens arrive (mask-image fades the top).
  const tail = text.slice(-220);
  return (
    <button type="button" className={styles.miniTypingCard} onClick={onClick}>
      <div className={styles.miniTypingHeader}>
        <span className={styles.miniTypingDot} />
        <span>正在撰写报告</span>
      </div>
      <div className={styles.miniTypingPreview}>
        <div className={styles.miniTypingPreviewInner}>
          {tail}
          <span className={styles.miniTypingCursor} />
        </div>
      </div>
      <div className={styles.miniTypingFooter}>
        <span>{text.length} 字</span>
        <span>点击展开 →</span>
      </div>
    </button>
  );
}

/* ====================================
   Skeleton Loaders
   ==================================== */
function SkeletonNewsCard() {
  return (
    <div className={styles.skeletonCard}>
      <div className={styles.skeletonMain}>
        <div className={`${styles.skeletonShimmer} ${styles.skeletonLine}`} style={{ width: '40%' }} />
        <div className={`${styles.skeletonShimmer} ${styles.skeletonTitle}`} style={{ width: '85%' }} />
        <div className={`${styles.skeletonShimmer} ${styles.skeletonLine} ${styles.skeletonSummary}`} style={{ width: '95%' }} />
        <div className={`${styles.skeletonShimmer} ${styles.skeletonLine}`} style={{ width: '70%' }} />
      </div>
      <div className={styles.skeletonMeta}>
        <div className={`${styles.skeletonShimmer} ${styles.skeletonLine}`} style={{ width: '60px' }} />
        <div className={`${styles.skeletonShimmer} ${styles.skeletonLine}`} style={{ width: '50px' }} />
        <div className={`${styles.skeletonShimmer} ${styles.skeletonLine}`} style={{ width: '40px' }} />
      </div>
    </div>
  );
}

function SkeletonNewsList() {
  return (
    <div className={styles.newsList}>
      <div className={styles.skeletonGroupHeader}>
        <div className={`${styles.skeletonShimmer} ${styles.skeletonLine}`} style={{ width: '90px' }} />
        <div className={`${styles.skeletonShimmer} ${styles.skeletonLine}`} style={{ width: '24px', height: '20px', borderRadius: '999px' }} />
      </div>
      {Array.from({ length: 4 }).map((_, i) => <SkeletonNewsCard key={i} />)}
    </div>
  );
}

function SkeletonReportItem() {
  return (
    <div className={styles.skeletonReportItem}>
      <div className={`${styles.skeletonShimmer} ${styles.skeletonLine}`} style={{ width: '60%' }} />
      <div className={`${styles.skeletonShimmer} ${styles.skeletonLine}`} style={{ width: '95%' }} />
      <div className={`${styles.skeletonShimmer} ${styles.skeletonLine}`} style={{ width: '40%' }} />
    </div>
  );
}

/* ====================================
   Empty State – Onboarding Hero
   ==================================== */
function OnboardingHero({ onStart, loading }: { onStart: () => void; loading: boolean }) {
  return (
    <div className={styles.onboardCard}>
      <div className={styles.onboardIconWrap}>
        <IconCompass size={28} />
      </div>
      <h3 className={styles.onboardTitle}>开始你的第一份 AI 趋势报告</h3>
      <p className={styles.onboardSubtitle}>
        从 Hacker News、Dev.to、36kr 等公开技术资讯中聚合最新 AI 动态，
        通过 4 步 Agent 流水线（采集 → 策展 → 摘要 → 分析）输出可追溯的趋势报告。
      </p>
      <div className={styles.onboardFeatureRow}>
        <span className={styles.onboardFeature}>
          <IconDatabase size={13} /> 多源采集
        </span>
        <span className={styles.onboardFeature}>
          <IconLayers size={13} /> 智能聚类
        </span>
        <span className={styles.onboardFeature}>
          <IconTrendingUp size={13} /> 持续追踪
        </span>
      </div>
      <button className={styles.onboardCta} onClick={onStart} disabled={loading}>
        {loading ? (
          <><span className={styles.btnSpinner} /> 正在生成...</>
        ) : (
          <><IconPlay size={16} /> 立即生成首份报告</>
        )}
      </button>
    </div>
  );
}

/* ====================================
   Main App
   ==================================== */
export default function App() {
  const [report, setReport] = useState<TrendReport>(EMPTY_REPORT);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [bootstrapping, setBootstrapping] = useState(true);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerReport, setDrawerReport] = useState<TrendReport | null>(null);
  const [pipelineStages, setPipelineStages] = useState<Record<string, StageState>>({});
  const [drawerLoading, setDrawerLoading] = useState(false);

  // Live (during-generation) state — driven by SSE `items` / `analysis` events.
  const [liveItems, setLiveItems] = useState<LiveItem[]>([]);
  const [livePhase, setLivePhase] = useState<LivePhase>('idle');
  const [liveAnalysis, setLiveAnalysis] = useState<
    { categories: AnalystCategoryEvent[]; deepDives?: AnalystDeepDiveEvent[]; keyInsight?: string } | null
  >(null);
  // Writer token stream (Phase 2): accumulated markdown text + drawer toggle.
  const [liveWriterText, setLiveWriterText] = useState('');
  const [streamingDrawerOpen, setStreamingDrawerOpen] = useState(false);

  const drawerBodyRef = useRef<HTMLDivElement | null>(null);
  const activeRunRef = useRef<AbortController | null>(null);
  // Timers that finalize the fade-out-and-remove animation for dropped items.
  const droppingTimersRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());

  const refresh = useCallback(async () => {
    const [latest, historyData] = await Promise.all([
      fetchLatest().catch(() => EMPTY_REPORT),
      fetchHistory().catch(() => []),
    ]);
    setReport(normalizeReport(latest));
    setHistory(historyData);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await refresh();
      } finally {
        if (!cancelled) setBootstrapping(false);
      }
    })();
    return () => { cancelled = true; };
  }, [refresh]);

  const run = useCallback(async () => {
    activeRunRef.current?.abort();
    const controller = new AbortController();
    activeRunRef.current = controller;
    setLoading(true);
    setPipelineStages({});
    // Reset live state for the new run.
    setLiveItems([]);
    setLiveAnalysis(null);
    setLivePhase('idle');
    setLiveWriterText('');
    droppingTimersRef.current.forEach(t => clearTimeout(t));
    droppingTimersRef.current.clear();

    try {
      const finalReport = await runReportSSE({
        onStage: (event: PipelineEvent) => {
          if (event.stage === 'complete' || event.stage === 'error') return;
          setPipelineStages(prev => ({
            ...prev,
            [event.stage]: {
              status: event.status as StageStatus,
              duration: event.duration,
              detail: event.detail,
            },
          }));
          if (event.stage === 'writer' && event.status === 'running') {
            setLivePhase('writing');
            // Fresh writer pass — reset the accumulator. (Defensive: a manual
            // restart should not show stale text from a previous run.)
            setLiveWriterText('');
          }
        },

        onItems: (event) => {
          if (event.phase === 'fetched') {
            setLiveItems(event.items.map(it => ({ ...it, _phase: 'fetched' })));
            setLivePhase('fetched');
          } else if (event.phase === 'curated') {
            // Compute droppedIds = previous items − newly-kept items, mark them
            // as `_dropping` for fade-out, then remove after the animation.
            const newIds = new Set(event.items.map(it => it.id));
            const newById = new Map(event.items.map(it => [it.id, it]));
            setLiveItems(prev => prev.map(it => {
              if (newIds.has(it.id)) {
                const updated = newById.get(it.id);
                return {
                  ...it,
                  ...(updated ?? {}),
                  _phase: 'curated',
                  _dropping: false,
                };
              }
              return { ...it, _dropping: true };
            }));
            // Schedule removal of dropped items after the CSS fade-out.
            const timer = setTimeout(() => {
              setLiveItems(prev => prev.filter(it => !it._dropping));
              droppingTimersRef.current.delete(timer);
            }, 650);
            droppingTimersRef.current.add(timer);
            setLivePhase('curated');
          } else if (event.phase === 'summarized') {
            const summaryById = new Map(event.items.map(it => [it.id, it]));
            setLiveItems(prev => prev.map(it => {
              const enriched = summaryById.get(it.id);
              if (!enriched) return it;
              return {
                ...it,
                aiSummary: enriched.aiSummary ?? it.aiSummary,
                category: enriched.category ?? it.category,
                _phase: 'summarized',
              };
            }));
            setLivePhase('summarized');
          }
        },

        onAnalysis: (event) => {
          setLiveAnalysis({
            categories: event.categories,
            deepDives: event.deepDives,
            keyInsight: event.keyInsight,
          });
          // Apply category / status / importance to each item from analyst output.
          const decoration = new Map<string, { cat: string; status: 'new' | 'active' | 'single'; importance: 'high' | 'medium' | 'low' }>();
          for (const cat of event.categories) {
            for (const ci of cat.items) {
              decoration.set(ci.id, { cat: cat.name, status: ci.status, importance: ci.importance });
            }
          }
          setLiveItems(prev => prev.map(it => {
            const dec = decoration.get(it.id);
            if (!dec) return it;
            return {
              ...it,
              _categoryAssigned: dec.cat,
              _categoryStatus: dec.status,
              _importance: dec.importance,
            };
          }));
          setLivePhase('analyzed');
        },

        onToken: (event) => {
          // Append each delta to the live markdown buffer driving the
          // sidebar mini-typing card and (if open) the streaming drawer.
          setLiveWriterText(prev => prev + event.delta);
        },
      }, controller.signal);

      if (finalReport) {
        const normalized = normalizeReport(finalReport);
        setReport(normalized);
        // If the user clicked the mini-typing card and is watching the
        // streaming drawer, seamlessly hand off to the formal drawer view
        // (with metadata pills) so they don't have to reopen anything.
        if (streamingDrawerOpen) {
          setDrawerReport(normalized);
          setStreamingDrawerOpen(false);
          setDrawerOpen(true);
        }
      }
      setHistory(await fetchHistory().catch(() => []));
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) {
        console.error(error);
      }
    } finally {
      if (activeRunRef.current === controller) activeRunRef.current = null;
      setLoading(false);
      setLivePhase('done');
      // Clear live state shortly after — final report takes over the news area.
      setTimeout(() => {
        setLiveItems([]);
        setLiveAnalysis(null);
      }, 400);
    }
  }, []);

  const stop = useCallback(async () => {
    activeRunRef.current?.abort();
    activeRunRef.current = null;
    setLoading(false);
    // Mark any running stages as skipped
    setPipelineStages(prev => {
      const next = { ...prev };
      for (const key of Object.keys(next)) {
        if (next[key].status === 'running') {
          next[key] = { ...next[key], status: 'skipped' };
        }
      }
      return next;
    });
    setLivePhase('done');
    setLiveWriterText('');
    await stopReport();
  }, []);

  const openReport = useCallback(async (runId?: string) => {
    if (!runId) return;
    setDrawerLoading(true);
    setDrawerReport(null);
    setDrawerOpen(true);
    try {
      const data = await fetchReportDetail(runId);
      setDrawerReport(normalizeReport(data));
      requestAnimationFrame(() => drawerBodyRef.current?.scrollTo(0, 0));
    } catch (error) {
      console.error(error);
    } finally {
      setDrawerLoading(false);
    }
  }, []);

  const openLatestReport = useCallback(() => {
    if (report.status === 'success') {
      setDrawerReport(report);
      setDrawerOpen(true);
      requestAnimationFrame(() => drawerBodyRef.current?.scrollTo(0, 0));
    }
  }, [report]);

  const closeDrawer = useCallback(() => {
    setDrawerOpen(false);
    setStreamingDrawerOpen(false);
  }, []);

  const handleDelete = useCallback(async (runId?: string) => {
    if (!runId) return;
    if (!confirm('确定删除这份报告？')) return;
    const success = await deleteReport(runId);
    if (success) {
      setHistory(prev => prev.filter(item => item.runId !== runId));
      if (report.runId === runId) setReport(EMPTY_REPORT);
      if (drawerReport?.runId === runId) setDrawerOpen(false);
    }
  }, [report.runId, drawerReport?.runId]);

  // Close drawer on Escape key
  useEffect(() => {
    if (!drawerOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeDrawer();
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [drawerOpen, closeDrawer]);

  // Lock body scroll when drawer is open (prevent scroll-through)
  useEffect(() => {
    if (drawerOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => { document.body.style.overflow = ''; };
  }, [drawerOpen]);

  // Keep the streaming drawer scrolled to the bottom as new tokens arrive,
  // so the user always sees the freshest text.
  useEffect(() => {
    if (!streamingDrawerOpen) return;
    const el = drawerBodyRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [streamingDrawerOpen, liveWriterText]);

  const safeReport = normalizeReport(report);
  const newsItems = safeReport.items;
  const newItems = useMemo(() => newsItems.filter(item => item.isNew), [newsItems]);
  const recurringItems = useMemo(() => newsItems.filter(item => !item.isNew), [newsItems]);
  const trendCount = safeReport.trends.length;
  const sourceNames = useMemo(() => Array.from(new Set(newsItems.map(item => item.source))).join(' / ') || 'Hacker News / Dev.to', [newsItems]);

  // After bootstrapping: do we have any content (latest report OR any history)?
  const hasAnyContent = safeReport.status === 'success' || history.length > 0 || newsItems.length > 0;
  const showOnboarding = !bootstrapping && !hasAnyContent && !loading;

  return (
    <main className={styles.shell}>
      <header className={styles.topbar}>
        <div className={styles.brandBlock}>
          <p className={styles.eyebrow}>AI Trends Monitor</p>
          <h1>AI 热点汇总</h1>
          <p>按计划采集公开技术资讯，沉淀为可追溯的 AI 趋势报告。</p>
          <p className={styles.scheduleHint}><IconClock size={12} /> 每日 9:00 自动采集</p>
        </div>
        <div className={styles.topActions}>
          <button className={styles.primaryButton} onClick={run} disabled={loading}>
            {loading ? (
              <><span className={styles.btnSpinner} /> 生成中...</>
            ) : (
              <><IconPlay className={styles.btnIcon} /> 手动生成</>
            )}
          </button>
          {loading && (
            <button className={styles.secondaryButton} onClick={stop}>
              <IconStop className={styles.btnIcon} /> 停止
            </button>
          )}
        </div>
      </header>

      <PipelineBar stages={pipelineStages} />

      {!bootstrapping && (
        <div className={styles.statsBar}>
          <span className={styles.statItem}>最近生成 <strong>{formatTime(safeReport.generatedAt)}</strong></span>
          <span className={styles.statDot}>·</span>
          <span className={styles.statItem}><strong>{safeReport.itemCount ?? newsItems.length}</strong> 条资讯</span>
          <span className={styles.statDot}>·</span>
          <span className={styles.statItem}><strong>{trendCount}</strong> 个主题</span>
          <span className={styles.statDot}>·</span>
          <span className={styles.statItem}>源 {sourceNames}</span>
        </div>
      )}

      <section className={styles.mainLayout}>
        {/* Main: News Feed */}
        <section className={styles.contentPanel}>
          <div className={styles.feedHeader}>
            <div>
              <p className={styles.panelLabel}>News Feed</p>
              <h2 className={styles.feedTitle}>资讯流</h2>
            </div>
            <button className={styles.ghostButton} onClick={refresh}>
              <IconRefresh className={styles.btnIcon} /> 刷新
            </button>
          </div>

          <div className={styles.filterRow}>
            <div className={styles.sourceList}>
              {(sourceNames.split(' / ')).map(source => <span key={source}>{source}</span>)}
            </div>
            <div className={styles.topicGrid}>
              {TOPICS.map(topic => <span key={topic}>{topic}</span>)}
            </div>
          </div>

          {bootstrapping ? (
            <SkeletonNewsList />
          ) : loading && liveItems.length > 0 ? (
            <LiveFeed items={liveItems} phase={livePhase} analysis={liveAnalysis} />
          ) : loading && !liveItems.length ? (
            // Loading just started, no items yet — short skeleton so users see
            // something move within the first 30s before Fetch completes.
            <SkeletonNewsList />
          ) : showOnboarding ? (
            <OnboardingHero onStart={run} loading={loading} />
          ) : (
            <div className={styles.newsList}>
              {safeReport.newItemCount === 0 && safeReport.status === 'success' && (
                <div className={styles.noNewBanner}>
                  本次未发现新的 AI 动态，以下为最近仍值得关注的资讯。
                </div>
              )}

              {newItems.length > 0 && (
                <>
                  <div className={styles.feedGroupHeader}>
                    <IconSparkle />
                    <span>新增资讯</span>
                    <span className={styles.feedGroupBadge}>{newItems.length}</span>
                  </div>
                  {newItems.map(item => (
                    <a
                      className={styles.newsCard}
                      href={item.url}
                      key={item.id}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <div className={styles.newsMain}>
                        <div className={styles.newsMetaTop}>
                          <span className={styles.sourceBadge}>{item.source}</span>
                          <span>{formatItemTime(item.publishedAt)}</span>
                          {item.isNew && <span className={styles.newBadge}>NEW</span>}
                        </div>
                        <strong>{item.title}</strong>
                        <p>{itemSummary(item)}</p>
                      </div>
                      <div className={styles.newsSideMeta}>
                        <span>{item.category || 'AI'}</span>
                        <span>score {item.score ?? 0}</span>
                        <span>
                          源站 <IconExternal size={11} style={{ verticalAlign: '-1px', marginLeft: 2 }} />
                        </span>
                      </div>
                    </a>
                  ))}
                </>
              )}

              {recurringItems.length > 0 && (
                <>
                  <div className={`${styles.feedGroupHeader} ${styles.recurring}`}>
                    <IconHistory />
                    <span>持续关注</span>
                    <span className={styles.feedGroupBadge}>{recurringItems.length}</span>
                  </div>
                  {recurringItems.map(item => (
                    <a
                      className={styles.newsCard}
                      href={item.url}
                      key={item.id}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <div className={styles.newsMain}>
                        <div className={styles.newsMetaTop}>
                          <span className={styles.sourceBadge}>{item.source}</span>
                          <span>{formatItemTime(item.publishedAt)}</span>
                          {item.isNew && <span className={styles.newBadge}>NEW</span>}
                        </div>
                        <strong>{item.title}</strong>
                        <p>{itemSummary(item)}</p>
                      </div>
                      <div className={styles.newsSideMeta}>
                        <span>{item.category || 'AI'}</span>
                        <span>score {item.score ?? 0}</span>
                        <span>
                          源站 <IconExternal size={11} style={{ verticalAlign: '-1px', marginLeft: 2 }} />
                        </span>
                      </div>
                    </a>
                  ))}
                </>
              )}

              {!newsItems.length && (
                <p className={styles.emptyText}>暂无资讯明细，点击"立即生成"后会在这里展示。</p>
              )}
            </div>
          )}
        </section>

        {/* Right Sidebar: Report History */}
        <aside className={styles.reportSidebar}>
          <div className={styles.sidebarHeader}>
            <div>
              <p className={styles.panelLabel}>Trend Reports</p>
              <h2 className={styles.sidebarTitle}>趋势报告</h2>
            </div>
            <span className={styles.reportHint}>
              {bootstrapping ? '—' : `${history.length} 份`}
            </span>
          </div>

          {bootstrapping ? (
            <div className={styles.reportList}>
              <SkeletonReportItem />
              <SkeletonReportItem />
              <SkeletonReportItem />
            </div>
          ) : (
            <>
              {/* Writer-streaming preview takes priority while it's running */}
              {liveWriterText.length > 0 && livePhase === 'writing' && (
                <MiniTypingCard
                  text={liveWriterText}
                  onClick={() => {
                    setStreamingDrawerOpen(true);
                    setDrawerOpen(true);
                  }}
                />
              )}

              {/* Latest report quick card */}
              {safeReport.status === 'success' && (
                <button type="button" className={styles.latestReportCard} onClick={openLatestReport}>
                  <div className={styles.latestReportHeader}>
                    <span className={styles.latestBadge}>最新</span>
                    <TriggerBadge trigger={safeReport.trigger} />
                    <span>{formatTime(safeReport.generatedAt)}</span>
                  </div>
                  <strong>{safeReport.summary || `${trendCount} 个趋势 · ${newsItems.length} 条资讯`}</strong>
                  <span className={styles.viewReportLink}>
                    查看完整报告 <IconArrowRight size={13} style={{ verticalAlign: '-2px', marginLeft: 2 }} />
                  </span>
                </button>
              )}

              {/* History list (exclude latest to avoid duplication) */}
              <div className={styles.reportList}>
                {history.filter(item => item.runId !== safeReport.runId).map(item => (
                  <div className={styles.reportItemWrap} key={item.runId || item.generatedAt}>
                    <button
                      type="button"
                      className={styles.reportItem}
                      onClick={() => openReport(item.runId)}
                    >
                      <div className={styles.reportItemTop}>
                        <strong>{formatTime(item.generatedAt)}</strong>
                        <TriggerBadge trigger={item.trigger} />
                        {item.status === 'failed' && <StatusPill status={item.status} />}
                      </div>
                      <p>{item.summary || item.error || '无摘要'}</p>
                      <div className={styles.reportItemMeta}>
                        {item.itemCount != null && <span>{item.itemCount} 条资讯</span>}
                        {item.newItemCount != null && <span>{item.newItemCount} 条新增</span>}
                      </div>
                    </button>
                    <button
                      type="button"
                      className={styles.deleteButton}
                      title="删除报告"
                      aria-label="删除报告"
                      onClick={(e) => { e.stopPropagation(); handleDelete(item.runId); }}
                    >
                      <IconX size={13} />
                    </button>
                  </div>
                ))}
                {!history.filter(item => item.runId !== safeReport.runId).length && safeReport.status !== 'success' && (
                  <div className={styles.sidebarEmpty}>
                    <IconBookmark />
                    <p className={styles.sidebarEmptyText}>暂无历史报告</p>
                    <p className={styles.sidebarEmptyHint}>生成后会在这里保留</p>
                  </div>
                )}
                {!history.filter(item => item.runId !== safeReport.runId).length && safeReport.status === 'success' && (
                  <div className={styles.sidebarEmpty}>
                    <IconInbox />
                    <p className={styles.sidebarEmptyHint}>暂无更多历史报告</p>
                  </div>
                )}
              </div>
            </>
          )}
        </aside>
      </section>

      {/* Report Drawer */}
      <div
        className={`${styles.drawerOverlay} ${drawerOpen ? styles.drawerOverlayVisible : ''}`}
        onClick={closeDrawer}
      />
      <aside className={`${styles.drawer} ${drawerOpen ? styles.drawerOpen : ''}`}>
        <div className={styles.drawerHeader}>
          <div>
            <p className={styles.panelLabel}>{streamingDrawerOpen ? 'Live Writing' : 'Full Report'}</p>
            <h2 className={styles.drawerTitle}>
              {streamingDrawerOpen
                ? '正在撰写报告...'
                : drawerReport?.generatedAt ? formatTime(drawerReport.generatedAt) : '趋势报告'}
            </h2>
          </div>
          <button type="button" className={styles.drawerClose} onClick={closeDrawer} aria-label="关闭">
            <IconX size={16} />
          </button>
        </div>

        {/* Streaming view — Writer's tokens accumulating live */}
        {streamingDrawerOpen && (
          <div className={styles.drawerBody} ref={drawerBodyRef}>
            <div className={styles.drawerMeta}>
              <span className={`${styles.reportMetaTag} ${styles.reportMetaTagLive}`}>
                <span className={styles.miniTypingDot} /> 实时生成中
              </span>
              <span className={styles.reportMetaTag}>{liveWriterText.length} 字</span>
            </div>
            <div className={styles.streamingMarkdownWrap}>
              <MarkdownReport markdown={liveWriterText} />
              <span className={styles.streamingCursor} />
            </div>
          </div>
        )}

        {/* Loading-detail view (when fetching a historical report) */}
        {!streamingDrawerOpen && drawerLoading && !drawerReport && (
          <div className={styles.drawerBody}>
            <p className={styles.drawerLoadingText}>加载报告中...</p>
          </div>
        )}

        {/* Formal report view */}
        {!streamingDrawerOpen && drawerReport && (
          <div className={styles.drawerBody} ref={drawerBodyRef}>
            <div className={styles.drawerMeta}>
              {drawerReport.itemCount != null && <span className={styles.reportMetaTag}>{drawerReport.itemCount} 条资讯</span>}
              {drawerReport.newItemCount != null && <span className={styles.reportMetaTag}>{drawerReport.newItemCount} 条新增</span>}
              {drawerReport.durationMs != null && <span className={styles.reportMetaTag}>{(drawerReport.durationMs / 1000).toFixed(1)}s</span>}
            </div>
            <MarkdownReport markdown={drawerReport.reportMarkdown} />
          </div>
        )}
      </aside>
    </main>
  );
}
