import { ReactElement, useState, useMemo, useEffect, createElement } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Ticket as TicketIcon,
  Layers,
  ChevronRight,
  PieChart as PieChartIcon,
  Circle,
  Hash,
  Loader2,
  AlertCircle,
} from 'lucide-react';
import {
  productInsightsService,
  MetaTheme,
  Cluster,
  Ticket,
  ProductInsightsData as Data,
} from '../../services/Analytics/productInsightsService';
import { useQuery } from '@tanstack/react-query';
import { queries } from '../../zero/queries';
import { useCachedQuery } from '../../hooks/useCachedQuery';
import { EntitySelector } from '../../components/ui/EntitySelector/EntitySelector';
import type { SelectorOption } from '../../components/ui/EntitySelector/EntitySelector.types';

// --- Colors & Utilities ---
// Use HSL to generate distinct colors dynamically based on the number of items
const getThemeColor = (index: number, total: number): string => {
  const hue = (index * 360) / total;
  return `hsl(${hue}, 70%, 60%)`;
};

// --- Pie Chart Component (Custom SVG) ---
interface PieSlice {
  color: string;
  value: number;
  label: string;
  metaTheme: MetaTheme;
}

const SimplePieChart = ({
  slices,
  onSelect,
  selectedTheme,
  data,
}: {
  slices: PieSlice[];
  onSelect: (theme: MetaTheme) => void;
  selectedTheme: MetaTheme | null;
  data: Data;
}): ReactElement => {
  const [hoveredSlice, setHoveredSlice] = useState<PieSlice | null>(null);

  const total = slices.reduce((acc, item) => acc + item.value, 0);
  let cumulativePercent = 0;

  // Determine what to show in the center
  const activeSlice = (): PieSlice | null => {
    // If a theme is selected, show that.
    // If no theme is selected but one is hovered, show the hovered one.
    if (selectedTheme) {
      return slices.find(p => p.metaTheme.meta_theme === selectedTheme.meta_theme) ?? null;
    }
    return hoveredSlice;
  };

  const currentSlice = activeSlice();

  const getCoordinatesForPercent = (percent: number): [number, number] => {
    const x = Math.cos(2 * Math.PI * percent);
    const y = Math.sin(2 * Math.PI * percent);
    return [x, y];
  };

  return (
    <div className='relative w-full aspect-square max-w-[340px] mx-auto my-8'>
      <svg viewBox='-1.2 -1.2 2.4 2.4' className='w-full h-full transform -rotate-90'>
        {slices.map((slice, i) => {
          const startPercent = cumulativePercent;
          const endPercent = cumulativePercent + slice.value / total;
          cumulativePercent = endPercent;

          const [startX, startY] = getCoordinatesForPercent(startPercent);
          const [endX, endY] = getCoordinatesForPercent(endPercent);

          const largeArcFlag = slice.value / total > 0.5 ? 1 : 0;

          const isSelected = selectedTheme?.meta_theme === slice.metaTheme.meta_theme;
          const isHovered = hoveredSlice?.metaTheme.meta_theme === slice.metaTheme.meta_theme;
          const isActive = isSelected || isHovered;

          // Path for the slice
          const pathData = `
            M 0 0
            L ${startX} ${startY}
            A 1 1 0 ${largeArcFlag} 1 ${endX} ${endY}
            Z
          `;

          return (
            <path
              key={i}
              d={pathData}
              fill={slice.color}
              stroke={isActive ? 'hsl(var(--card))' : 'transparent'}
              strokeWidth={isActive ? 0.05 : 0}
              onMouseEnter={() => setHoveredSlice(slice)}
              onMouseLeave={() => setHoveredSlice(null)}
              className={`cursor-pointer transition-all duration-300 ${
                isActive
                  ? 'scale-110 drop-shadow-lg opacity-100'
                  : selectedTheme || hoveredSlice
                    ? 'opacity-40'
                    : 'opacity-90 hover:scale-105'
              }`}
              style={{ transformOrigin: 'center', transformBox: 'fill-box' }}
              onClick={() => onSelect(slice.metaTheme)}
              data-track-category='ProductInsights'
              data-track-name='SelectPieSlice'
              data-track-metadata={JSON.stringify({
                themeName: slice.metaTheme.meta_theme,
                clusterCount: slice.value,
              })}
            >
              <title>{`${slice.label} (${slice.value} clusters)`}</title>
            </path>
          );
        })}
        {/* Inner Circle for Donut Effect */}
        <circle cx='0' cy='0' r='0.75' fill='hsl(var(--card))' />
      </svg>
      <div className='absolute inset-0 flex items-center justify-center pointer-events-none'>
        <div
          className='text-center flex flex-col items-center justify-center animate-in fade-in duration-200 w-[55%] mx-auto'
          key={currentSlice ? currentSlice.label : 'total'}
        >
          {currentSlice ? (
            <>
              <div className='text-3xl font-bold text-foreground leading-none mb-1'>
                {currentSlice.value}
              </div>
              <div className='text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-1'>
                Clusters
              </div>

              <div className='h-px w-12 bg-border my-2' />

              <div className='text-xl font-bold text-foreground leading-none mb-1'>
                {currentSlice.metaTheme.impacted_clusters.reduce(
                  (acc, cid) => acc + (data.cluster_details[cid]?.length || 0),
                  0,
                )}
              </div>
              <div className='text-[10px] font-bold text-muted-foreground uppercase tracking-widest'>
                Tickets
              </div>
            </>
          ) : (
            <>
              <div className='text-4xl font-bold text-foreground leading-tight'>
                {slices.length}
              </div>
              <div className='text-xs font-bold text-muted-foreground uppercase tracking-widest mt-1'>
                Meta
                <br />
                Themes
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

// --- Components ---

const MetaThemeItem = ({
  theme,
  color,
  isSelected,
  onClick,
}: {
  theme: MetaTheme;
  color: string;
  isSelected: boolean;
  onClick: () => void;
}): ReactElement => (
  <div
    role='button'
    tabIndex={0}
    onClick={onClick}
    onKeyDown={e => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onClick();
      }
    }}
    className={`p-4 rounded-lg cursor-pointer transition-all duration-200 mb-2 group ${
      isSelected ? 'bg-muted shadow-sm ring-1 ring-border' : 'hover:bg-muted/80'
    }`}
    data-track-category='ProductInsights'
    data-track-name='SelectMetaTheme'
    data-track-metadata={JSON.stringify({ themeName: theme.meta_theme, isSelected })}
  >
    <div className='flex items-start gap-3'>
      <div
        className={`w-2.5 h-2.5 rounded-full flex-shrink-0 transition-transform duration-300 mt-1.5 ${isSelected ? 'scale-110' : 'group-hover:scale-110'}`}
        style={{ backgroundColor: color }}
      />
      <div className='flex-1 min-w-0'>
        <div className='flex justify-between items-center mb-0.5'>
          <h3 className={`text-sm font-medium truncate pr-2 text-foreground`}>
            {theme.meta_theme}
          </h3>
          {isSelected && <ChevronRight size={14} className='text-muted-foreground' />}
        </div>
        <div
          className={`transition-all duration-300 ease-in-out overflow-hidden ${isSelected ? 'max-h-40' : 'max-h-[1.4em]'}`}
        >
          <p className='text-xs leading-relaxed text-muted-foreground'>{theme.description}</p>
        </div>
      </div>
    </div>
  </div>
);

const ClusterBarItem = ({
  cluster,
  isSelected,
  onClick,
  count,
  maxCount,
}: {
  cluster: Cluster;
  isSelected: boolean;
  onClick: () => void;
  count: number;
  maxCount: number;
}): ReactElement => {
  const widthPercentage = maxCount > 0 ? (count / maxCount) * 100 : 0;

  return (
    <div
      role='button'
      tabIndex={0}
      onClick={onClick}
      data-track-category='ProductInsights'
      data-track-name='SelectCluster'
      data-track-metadata={JSON.stringify({ clusterTitle: cluster.theme_title })}
      onKeyDown={e => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick();
        }
      }}
      className={`group mb-6 cursor-pointer select-none`}
    >
      <div className='flex justify-between items-center mb-2'>
        <h4
          className={`text-sm font-medium pr-3 truncate transition-colors ${isSelected ? 'text-foreground' : 'text-muted-foreground group-hover:text-foreground'}`}
        >
          {cluster.theme_title}
        </h4>
        <span
          className={`text-[10px] font-mono font-bold px-1.5 py-0.5 rounded transition-colors ${isSelected ? 'bg-foreground text-background' : 'bg-muted text-muted-foreground'}`}
        >
          {count}
        </span>
      </div>

      <div className='relative h-2 w-full bg-muted rounded-full overflow-hidden'>
        <div
          className='h-full rounded-full transition-all duration-500 ease-out relative'
          style={{
            width: `${Math.max(widthPercentage, 2)}%`,
            backgroundColor: 'hsl(var(--foreground))',
            opacity: isSelected ? 1 : 0.3,
          }}
        />
      </div>

      <p
        className={`text-xs mt-2 text-muted-foreground leading-relaxed overflow-hidden transition-all duration-300 ${
          isSelected ? 'opacity-100 max-h-20 mb-4' : 'opacity-0 max-h-0'
        }`}
      >
        {cluster.theme_description}
      </p>
    </div>
  );
};

interface TicketDataFromZero {
  id: string;
  projectId: string | null;
  boardId: string | null;
}

const TicketItem = ({
  ticket,
  ticketData,
}: {
  ticket: Ticket;
  ticketData: TicketDataFromZero | undefined;
}): ReactElement => {
  const navigate = useNavigate();

  return (
    <div
      role='button'
      tabIndex={0}
      onClick={() => {
        // Navigate to ticket detail page using the ticket's projectId, boardId, and docId
        if (ticketData?.projectId && ticketData?.boardId) {
          void navigate(`/projects/${ticketData.projectId}/${ticketData.boardId}/${ticket.docId}`);
        }
      }}
      onKeyDown={e => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          if (ticketData?.projectId && ticketData?.boardId) {
            void navigate(
              `/projects/${ticketData.projectId}/${ticketData.boardId}/${ticket.docId}`,
            );
          }
        }
      }}
      className='p-5 rounded-lg bg-card mb-3 border border-transparent shadow-sm hover:shadow-md hover:border-border transition-all duration-200 group cursor-pointer'
      data-track-category='ProductInsights'
      data-track-name='NavigateToTicket'
      data-track-metadata={JSON.stringify({
        ticketId: ticket.docId,
        projectId: ticketData?.projectId,
      })}
    >
      <div className='flex items-start gap-3 mb-2'>
        <div className='mt-0.5 p-1.5 rounded-md bg-muted text-muted-foreground flex-shrink-0 opacity-80 group-hover:opacity-100 transition-opacity'>
          <TicketIcon size={14} />
        </div>
        <h5 className='text-sm font-medium text-foreground leading-snug group-hover:text-muted-foreground transition-colors'>
          {ticket.title}
        </h5>
      </div>
      <div className='pl-[38px]'>
        <p className='text-xs text-muted-foreground whitespace-pre-line leading-relaxed'>
          {ticket.description}
        </p>
      </div>
    </div>
  );
};

const EmptyState = ({
  icon,
  message,
}: {
  icon: React.ComponentType<{ size: number }>;
  message: string;
}): ReactElement => (
  <div className='flex flex-col items-center justify-center h-64 text-muted-foreground'>
    <div className='p-4 rounded-full bg-muted mb-3'>{createElement(icon, { size: 24 })}</div>
    <p className='text-sm'>{message}</p>
  </div>
);

// --- Main Screen ---

const ProductInsightsScreen = (): ReactElement => {
  const [selectedMetaTheme, setSelectedMetaTheme] = useState<MetaTheme | null>(null);
  const [selectedClusterId, setSelectedClusterId] = useState<string | null>(null);

  const [projectId, setProjectId] = useState<string | null>(null);
  const [projects] = useCachedQuery(queries.getAllProjects());

  useEffect(() => {
    if (!projectId && projects && projects.length > 0) {
      setProjectId(projects[0]!.id);
    }
  }, [projectId, projects]);

  const {
    data,
    isLoading: loading,
    error: queryError,
  } = useQuery({
    queryKey: ['productInsights', projectId],
    queryFn: () =>
      productInsightsService.getProductInsights({
        projectId: projectId as string,
      }),
    enabled: Boolean(projectId),
  });

  const error = queryError
    ? queryError instanceof Error
      ? queryError.message
      : 'Failed to fetch insights'
    : null;
  const errorStatus =
    queryError && typeof (queryError as { status?: number }).status === 'number'
      ? (queryError as { status?: number }).status
      : null;
  const isNotFoundError =
    errorStatus === 404 ||
    (queryError instanceof Error && queryError.message.toLowerCase().includes('not found'));

  useEffect(() => {
    setSelectedMetaTheme(null);
    setSelectedClusterId(null);
  }, [data]);

  // Prepare Pie Chart Data
  const pieData: PieSlice[] = useMemo(() => {
    if (!data) return [];
    return data.meta_themes.map((theme, index) => ({
      color: getThemeColor(index, data.meta_themes.length),
      value: theme.impacted_clusters.length,
      label: theme.meta_theme,
      metaTheme: theme,
    }));
  }, [data]);

  const allTicketIds = useMemo(() => {
    if (!data) return [];
    const ids = new Set<string>();
    Object.values(data.cluster_details).forEach(tickets => {
      tickets.forEach(ticket => ids.add(ticket.docId));
    });
    return Array.from(ids);
  }, [data]);

  const [ticketsFromZero] = useCachedQuery(queries.ticketsByIds({ ticketIds: allTicketIds }));

  const ticketDataMap = useMemo(() => {
    const map = new Map<string, TicketDataFromZero>();
    ticketsFromZero?.forEach(ticket => {
      map.set(ticket.id, {
        id: ticket.id,
        projectId: ticket.projectId,
        boardId: ticket.boardId,
      });
    });
    return map;
  }, [ticketsFromZero]);

  const handleMetaThemeSelect = (theme: MetaTheme): void => {
    if (selectedMetaTheme?.meta_theme === theme.meta_theme) {
      setSelectedMetaTheme(null);
      setSelectedClusterId(null);
    } else {
      setSelectedMetaTheme(theme);
      setSelectedClusterId(null);
    }
  };

  const totalMetaThemes = data?.meta_themes.length ?? 0;
  const totalClusters = data ? Object.keys(data.cluster_themes).length : 0;
  const totalTickets = data
    ? Object.values(data.cluster_details).reduce((sum, tickets) => sum + tickets.length, 0)
    : 0;
  const showInsightsUnavailable = isNotFoundError && !data;

  const projectOptions = useMemo<SelectorOption[]>(() => {
    return (projects ?? []).map(project => ({
      value: project.id,
      label: project.name,
      icon: null,
    }));
  }, [projects]);

  if (projects === undefined || !projectId || loading) {
    return (
      <div className='flex-1 bg-background flex items-center justify-center h-full md:rounded-2xl overflow-hidden shadow-md'>
        <div className='flex flex-col items-center gap-3'>
          <Loader2 size={32} className='animate-spin text-action-primary' />
          <p className='text-sm text-muted-foreground'>Loading insights...</p>
        </div>
      </div>
    );
  }

  if (!projects || projects.length === 0) {
    return (
      <div className='flex-1 bg-background flex items-center justify-center h-full md:rounded-2xl overflow-hidden shadow-md'>
        <div className='flex flex-col items-center gap-3 max-w-md text-center p-6'>
          <AlertCircle size={32} className='text-destructive' />
          <p className='text-sm text-foreground font-medium'>No projects available</p>
          <p className='text-xs text-muted-foreground'>Create a project to view insights.</p>
        </div>
      </div>
    );
  }

  if ((error && !isNotFoundError) || (!data && !isNotFoundError)) {
    return (
      <div className='flex-1 bg-background flex items-center justify-center h-full md:rounded-2xl overflow-hidden shadow-md'>
        <div className='flex flex-col items-center gap-3 max-w-md text-center p-6'>
          <AlertCircle size={32} className='text-destructive' />
          <p className='text-sm text-foreground font-medium'>Failed to load insights</p>
          <p className='text-xs text-muted-foreground'>{error || 'No data available'}</p>
        </div>
      </div>
    );
  }

  return (
    <div className='flex-1 bg-background flex flex-col h-full md:rounded-2xl overflow-hidden shadow-md'>
      {/* Header */}
      <div className='px-6 py-5 bg-background border-b border-border'>
        <div className='flex justify-between items-center mb-4'>
          <div className='flex items-center gap-3'>
            <div className='p-2 rounded-lg'>
              <PieChartIcon size={24} />
            </div>
            <div>
              <h1 className='text-lg font-sf-pro-expanded font-bold text-foreground'>
                Product Insights
              </h1>
              <p className='text-xs text-muted-foreground'>Analyze feedback clusters and themes</p>
            </div>
          </div>
          <div className='flex items-center gap-4 text-xs text-muted-foreground'>
            <div className='flex items-center gap-1.5'>
              <Circle size={8} className='fill-current text-muted' />
              <span>{totalMetaThemes} Meta Themes</span>
            </div>
            <div className='flex items-center gap-1.5'>
              <Layers size={12} />
              <span>{totalClusters} Clusters</span>
            </div>
            <div className='flex items-center gap-1.5'>
              <Hash size={12} />
              <span>{totalTickets} Tickets</span>
            </div>
          </div>
        </div>

        {/* Selectors */}
        <div className='flex items-center gap-4'>
          <div className='flex items-center gap-2'>
            <span className='text-xs font-medium text-muted-foreground'>Project:</span>
            <EntitySelector
              options={projectOptions}
              selectedValue={projectId}
              onSelect={val => {
                if (val) setProjectId(val);
              }}
              placeholder='Select project'
              searchPlaceholder='Search projects...'
              showSearch={false}
              inputClassName='px-1.5 py-1.5 text-xs rounded-lg border border-input bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring'
              showIndicator={true}
              width='auto'
            />
          </div>
        </div>
      </div>

      {/* 3-Column Layout */}
      <div className='flex-1 flex overflow-hidden'>
        {showInsightsUnavailable ? (
          <div className='flex-1 flex items-center justify-center bg-background'>
            <div className='flex flex-col items-center gap-3 max-w-md text-center p-6'>
              <AlertCircle size={32} className='text-muted-foreground' />
              <p className='text-sm text-foreground font-medium'>Insights not available</p>
              <p className='text-xs text-muted-foreground'>
                Not enough tickets found or insights not generated for this project.
              </p>
            </div>
          </div>
        ) : (
          data && (
            <>
              {/* Column 1: Meta Themes (Fixed Width) */}
              <div className='w-[420px] flex-shrink-0 flex flex-col border-r border-border bg-background'>
                <div className='p-6 border-b border-border'>
                  <SimplePieChart
                    slices={pieData}
                    onSelect={handleMetaThemeSelect}
                    selectedTheme={selectedMetaTheme}
                    data={data}
                  />
                  <div className='text-center mt-2'>
                    <p className='text-xs font-medium text-muted-foreground uppercase tracking-widest'>
                      Select a Theme
                    </p>
                  </div>
                </div>
                <div className='flex-1 overflow-y-auto p-4 scrollbar-sleek bg-muted/50'>
                  {data.meta_themes.map((theme, index) => (
                    <MetaThemeItem
                      key={index}
                      theme={theme}
                      color={getThemeColor(index, data.meta_themes.length)}
                      isSelected={selectedMetaTheme?.meta_theme === theme.meta_theme}
                      onClick={() => handleMetaThemeSelect(theme)}
                      data-track-category='ProductInsights'
                      data-track-name='SelectMetaTheme'
                      data-track-metadata={JSON.stringify({ metaTheme: theme.meta_theme })}
                    />
                  ))}
                </div>
              </div>

              {/* Column 2: Clusters (Fixed Width) */}
              <div className='w-[480px] flex-shrink-0 flex flex-col border-r border-border bg-muted'>
                <div className='p-[18.5px] border-b border-border bg-background sticky top-0 z-10 flex justify-between items-center'>
                  <h2 className='text-xs font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-2'>
                    <Layers size={14} />
                    <span>Impacted Clusters</span>
                  </h2>
                  {selectedMetaTheme && (
                    <span className='text-[10px] bg-muted px-2 py-0.5 rounded-full text-muted-foreground'>
                      {selectedMetaTheme.impacted_clusters.length}
                    </span>
                  )}
                </div>
                <div className='flex-1 overflow-y-auto p-6 scrollbar-sleek'>
                  {selectedMetaTheme ? (
                    ((): ReactElement[] => {
                      const maxCount = selectedMetaTheme.impacted_clusters.reduce(
                        (max, cid) => Math.max(max, data.cluster_details[cid]?.length || 0),
                        0,
                      );
                      const sortedClusters = [...selectedMetaTheme.impacted_clusters].sort(
                        (a, b) => {
                          const countA = data.cluster_details[a]?.length || 0;
                          const countB = data.cluster_details[b]?.length || 0;
                          return countB - countA;
                        },
                      );
                      return sortedClusters
                        .map(clusterId => {
                          const cluster = data.cluster_themes[clusterId];
                          if (!cluster) return null;
                          const count = data.cluster_details[clusterId]?.length || 0;
                          return (
                            <ClusterBarItem
                              key={clusterId}
                              cluster={cluster}
                              isSelected={selectedClusterId === clusterId}
                              onClick={() => setSelectedClusterId(clusterId)}
                              count={count}
                              maxCount={maxCount}
                              data-track-category='ProductInsights'
                              data-track-name='SelectCluster'
                              data-track-metadata={JSON.stringify({ clusterId })}
                            />
                          );
                        })
                        .filter((item): item is ReactElement => item !== null);
                    })()
                  ) : (
                    <EmptyState icon={PieChartIcon} message='Select a theme to view clusters' />
                  )}
                </div>
              </div>

              {/* Column 3: Tickets (Flexible Width) */}
              <div className='flex-1 flex flex-col bg-muted'>
                <div className='p-5 border-b border-border bg-background sticky top-0 z-10 min-h-[57px] flex items-center'>
                  <h2 className='text-xs font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-2'>
                    <TicketIcon size={14} />
                    <span>Associated Tickets</span>
                  </h2>
                </div>
                <div className='flex-1 overflow-y-auto p-6 scrollbar-sleek'>
                  {selectedClusterId ? (
                    <div className='max-w-3xl mx-auto w-full'>
                      {data.cluster_details[selectedClusterId]?.map(ticket => (
                        <TicketItem
                          key={ticket.docId}
                          ticket={ticket}
                          ticketData={ticketDataMap.get(ticket.docId)}
                        />
                      ))}
                      {(!data.cluster_details[selectedClusterId] ||
                        data.cluster_details[selectedClusterId]?.length === 0) && (
                        <div className='text-center p-8 text-muted-foreground'>
                          No tickets found for this cluster.
                        </div>
                      )}
                    </div>
                  ) : (
                    <EmptyState icon={Layers} message='Select a cluster to view tickets' />
                  )}
                </div>
              </div>
            </>
          )
        )}
      </div>
    </div>
  );
};

export default ProductInsightsScreen;
