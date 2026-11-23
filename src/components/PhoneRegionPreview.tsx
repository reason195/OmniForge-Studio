import type { NormalizedRegion } from '../core/ir';

interface PhoneRegionPreviewProps {
  mode: 'region' | 'point' | 'swipe';
  region?: NormalizedRegion;
  point?: { xRatio: number; yRatio: number; offsetXRatio?: number; offsetYRatio?: number };
  swipe?: { x0Ratio: number; y0Ratio: number; x1Ratio: number; y1Ratio: number };
}

export function PhoneRegionPreview({ mode, region, point, swipe }: PhoneRegionPreviewProps) {
  const clamp = (v: number) => Math.max(0, Math.min(1, Number.isFinite(v) ? v : 0));

  return (
    <div className="flex items-start gap-4 p-3 bg-slate-50 border border-slate-200 rounded-md">
      <div
        className="relative w-24 h-44 bg-slate-900 rounded-md border border-slate-700 overflow-hidden shrink-0"
        aria-label="Normalized 9:16 screen coordinate preview"
      >
        {/* Subtle 3x3 normalized grid */}
        <div className="absolute inset-0 grid grid-cols-3 grid-rows-3 pointer-events-none">
          {Array.from({ length: 9 }).map((_, idx) => (
            <div key={idx} className="border border-slate-800/70" />
          ))}
        </div>

        {mode === 'region' && region && (
          <div
            className="absolute bg-blue-500/25 border border-blue-400"
            style={{
              left: `${clamp(region.x0) * 100}%`,
              top: `${clamp(region.y0) * 100}%`,
              width: `${Math.max(2, (clamp(region.x1) - clamp(region.x0)) * 100)}%`,
              height: `${Math.max(2, (clamp(region.y1) - clamp(region.y0)) * 100)}%`,
            }}
          />
        )}

        {mode === 'point' && point && (
          <div
            className="absolute w-3 h-3 -ml-1.5 -mt-1.5 rounded-full border-2 border-amber-400 bg-amber-400/30"
            style={{
              left: `${clamp(point.xRatio + (point.offsetXRatio ?? 0)) * 100}%`,
              top: `${clamp(point.yRatio + (point.offsetYRatio ?? 0)) * 100}%`,
            }}
          />
        )}

        {mode === 'swipe' && swipe && (
          <svg viewBox="0 0 100 100" className="absolute inset-0 w-full h-full" preserveAspectRatio="none">
            <defs>
              <marker id="swipeArrow" markerWidth="6" markerHeight="6" refX="4" refY="3" orient="auto">
                <path d="M0,0 L6,3 L0,6 Z" fill="#38bdf8" />
              </marker>
            </defs>
            <line
              x1={clamp(swipe.x0Ratio) * 100}
              y1={clamp(swipe.y0Ratio) * 100}
              x2={clamp(swipe.x1Ratio) * 100}
              y2={clamp(swipe.y1Ratio) * 100}
              stroke="#38bdf8"
              strokeWidth="2.5"
              markerEnd="url(#swipeArrow)"
            />
          </svg>
        )}
      </div>

      <div className="text-xs text-slate-600 space-y-1.5 leading-relaxed">
        <div className="font-semibold text-slate-900">归一化比例坐标预览 (0.00–1.00)</div>
        {mode === 'region' && region && (
          <div className="font-mono tabular-nums text-[11px] text-slate-700 space-y-0.5">
            <div>x0: {region.x0.toFixed(2)} · y0: {region.y0.toFixed(2)}</div>
            <div>x1: {region.x1.toFixed(2)} · y1: {region.y1.toFixed(2)}</div>
            <div className="text-slate-500">1080×2400 换算: [{Math.round(region.x0 * 1080)}, {Math.round(region.y0 * 2400)}]</div>
          </div>
        )}
        {mode === 'point' && point && (
          <div className="font-mono tabular-nums text-[11px] text-slate-700 space-y-0.5">
            <div>基准: ({point.xRatio.toFixed(2)}, {point.yRatio.toFixed(2)})</div>
            <div>偏移: ({(point.offsetXRatio ?? 0).toFixed(2)}, {(point.offsetYRatio ?? 0).toFixed(2)})</div>
          </div>
        )}
        {mode === 'swipe' && swipe && (
          <div className="font-mono tabular-nums text-[11px] text-slate-700 space-y-0.5">
            <div>起点: ({swipe.x0Ratio.toFixed(2)}, {swipe.y0Ratio.toFixed(2)})</div>
            <div>终点: ({swipe.x1Ratio.toFixed(2)}, {swipe.y1Ratio.toFixed(2)})</div>
          </div>
        )}
      </div>
    </div>
  );
}
