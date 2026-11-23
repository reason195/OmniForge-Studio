import { Download } from 'lucide-react';

export type StudioTab = 'canvas' | 'mcp' | 'export' | 'architecture';

interface TopBarProps {
  activeTab: StudioTab;
  onSelectTab: (tab: StudioTab) => void;
  onExportScript: () => void;
}

const NAV_ITEMS: Array<{ id: StudioTab; label: string }> = [
  { id: 'canvas', label: 'Workflow Canvas' },
  { id: 'mcp', label: 'MCP & Traffic' },
  { id: 'export', label: 'Code & Export' },
  { id: 'architecture', label: 'Native Architecture' },
];

export function TopBar({ activeTab, onSelectTab, onExportScript }: TopBarProps) {
  return (
    <header className="flex items-center justify-between gap-8 px-6 h-14 bg-white border-b border-slate-200 shrink-0">
      <a
        href="#top"
        onClick={(e) => {
          e.preventDefault();
          onSelectTab('canvas');
        }}
        className="text-base font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0 font-display"
      >
        OmniForge Studio
      </a>

      <nav aria-label="Primary Workspace Views" className="flex items-center gap-6 overflow-x-auto">
        {NAV_ITEMS.map((item) => {
          const active = activeTab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => onSelectTab(item.id)}
              className={`py-4 text-sm font-medium border-b-2 transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 ${
                active
                  ? 'border-blue-600 text-slate-900'
                  : 'border-transparent text-slate-500 hover:text-slate-900'
              }`}
            >
              {item.label}
            </button>
          );
        })}
      </nav>

      <div className="flex items-center shrink-0">
        <button
          type="button"
          onClick={onExportScript}
          className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2"
        >
          <Download className="w-3.5 h-3.5" aria-hidden="true" />
          <span>Export .js</span>
        </button>
      </div>
    </header>
  );
}
