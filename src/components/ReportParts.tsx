"use client";
// Report building blocks: a table whose figures open their underlying list, a compact chart in the
// dashboard's style, the drill-down drawer, and the Excel / PDF / CSV export buttons.
import { useState } from "react";
import ReactECharts from "echarts-for-react";
import { App, Button, Drawer, Empty, Table, Tooltip } from "antd";
import { FileExcelOutlined, FilePdfOutlined, FileTextOutlined, UnorderedListOutlined } from "@ant-design/icons";
import { drillDown } from "@/app/actions/reports";
import { formatCell, type Cell, type Drill, type DrillResult, type Report, type ReportChart as Chart, type ReportCol } from "@/lib/report-types";

// Same chart ink as the executive dashboard (ExecutiveDashboard.tsx).
const INK = { axis: "#8a9892", grid: "#eef2f0", text: "#33433c" };
const tooltip = {
  trigger: "axis" as const,
  axisPointer: { type: "shadow" as const, shadowStyle: { color: "rgba(11,110,79,0.06)" } },
  backgroundColor: "#fff",
  borderColor: "#e3e8e5",
  textStyle: { color: "#0f1f1a", fontSize: 12 },
  extraCssText: "box-shadow:0 6px 24px rgba(16,40,30,.12);border-radius:10px;",
};
const NUMERIC = new Set(["int", "pct", "num", "money"]);

/** Row highlight for flagged rows (expiring soon, over intake, above ratio) and bold totals. */
export const ReportTableStyles = () => (
  <style>{`
    .rpt-row-bad > td { background: #fff6f5 !important; }
    .rpt-row-warn > td { background: #fffaf0 !important; }
    .rpt-row-total > td { font-weight: 600; background: #f7f9f8 !important; }
    .rpt-fig { padding: 0; height: auto; font-weight: 600; font-variant-numeric: tabular-nums; }
    .rpt-fig:hover { text-decoration: underline; }
  `}</style>
);

export function ExportButtons({ base, query, testId }: { base: string; query: string; testId?: string }) {
  const href = (f: string) => `${base}?format=${f}${query ? `&${query}` : ""}`;
  return (
    <span data-testid={testId} style={{ display: "inline-flex", gap: 6, flexWrap: "wrap" }}>
      <Button size="small" href={href("xlsx")} icon={<FileExcelOutlined style={{ color: "#1d6f42" }} />}>
        Excel
      </Button>
      <Button size="small" href={href("pdf")} icon={<FilePdfOutlined style={{ color: "#b4141f" }} />}>
        PDF
      </Button>
      <Button size="small" href={href("csv")} icon={<FileTextOutlined />}>
        CSV
      </Button>
    </span>
  );
}

/** Opens the list behind a figure in a side drawer. */
export function useDrill() {
  const { message } = App.useApp();
  const [state, setState] = useState<{ drill: Drill; result: DrillResult | null } | null>(null);
  const open = async (drill: Drill) => {
    setState({ drill, result: null });
    const r = await drillDown(drill);
    if (!r.ok) {
      message.error(r.message);
      setState(null);
      return;
    }
    setState({ drill, result: r.result });
  };
  const drawer = (
    <Drawer
      open={!!state}
      onClose={() => setState(null)}
      size={Math.min(980, typeof window === "undefined" ? 980 : window.innerWidth - 40)}
      title={
        <span>
          <UnorderedListOutlined style={{ color: "var(--brand)", marginRight: 8 }} />
          {state?.drill.label}
        </span>
      }
      extra={state?.result ? <span className="muted" style={{ fontSize: 12.5 }}>{state.result.rows.length}{state.result.truncated ? "+" : ""} rows</span> : null}
      destroyOnHidden
    >
      <div data-testid="drill-list">
        {state?.result?.truncated ? <p className="muted" style={{ marginTop: 0 }}>Showing the first 500 rows. Narrow the filters to see the rest.</p> : null}
        <Table
          size="small"
          loading={!state?.result}
          rowKey="__row"
          dataSource={(state?.result?.rows ?? []).map((r, i) => ({ ...r, __row: i }))}
          pagination={{ pageSize: 50, hideOnSinglePage: true, showSizeChanger: false }}
          locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No records behind this figure" /> }}
          columns={(state?.result?.columns ?? []).map((c) => ({
            title: c.title,
            dataIndex: c.key,
            align: NUMERIC.has(c.type ?? "") ? ("right" as const) : undefined,
            render: (v: Cell) => (c.type === "code" ? <span className="mono">{formatCell(v, c.type)}</span> : formatCell(v, c.type)),
          }))}
          scroll={{ x: true }}
        />
      </div>
    </Drawer>
  );
  return { open, drawer };
}

export function Figure({ value, type, drill, onDrill }: { value: Cell; type?: ReportCol["type"]; drill?: Drill; onDrill: (d: Drill) => void }) {
  const text = formatCell(value, type);
  if (!drill || value === null || value === undefined) return <span className="tnum">{text}</span>;
  return (
    <Tooltip title={`Open the list: ${drill.label}`} mouseEnterDelay={0.4}>
      <Button type="link" className="rpt-fig" data-drill={drill.kind} onClick={() => onDrill(drill)}>
        {text}
      </Button>
    </Tooltip>
  );
}

export function ReportTable({ report, onDrill, pageSize = 0 }: { report: Pick<Report, "columns" | "rows">; onDrill: (d: Drill) => void; pageSize?: number }) {
  return (
    <Table
      size="middle"
      rowKey="key"
      dataSource={report.rows}
      pagination={pageSize ? { pageSize, hideOnSinglePage: true, showSizeChanger: false } : false}
      rowClassName={(r) => (r.total ? "rpt-row-total" : r.flag === "bad" ? "rpt-row-bad" : r.flag === "warn" ? "rpt-row-warn" : "")}
      locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No rows match these filters" /> }}
      scroll={{ x: true }}
      columns={report.columns.map((c, i) => ({
        title: c.title,
        key: c.key,
        align: NUMERIC.has(c.type ?? "") ? ("right" as const) : undefined,
        render: (_: unknown, r: Report["rows"][number]) => {
          const v = r.cells[c.key];
          const d = r.drill?.[c.key];
          if (NUMERIC.has(c.type ?? "")) return <Figure value={v} type={c.type} drill={d} onDrill={onDrill} />;
          if (c.type === "code") return <span className="mono" style={{ whiteSpace: "nowrap" }}>{formatCell(v, c.type)}</span>;
          if (c.type === "date") return <span style={{ whiteSpace: "nowrap" }}>{formatCell(v, c.type)}</span>;
          if (d)
            return (
              <Button type="link" style={{ padding: 0, height: "auto", textAlign: "left", whiteSpace: "normal" }} onClick={() => onDrill(d)}>
                {formatCell(v, c.type)}
              </Button>
            );
          return <span style={i === 0 ? { fontWeight: 500 } : undefined}>{formatCell(v, c.type)}</span>;
        },
      }))}
    />
  );
}

export function ReportChart({ chart, onDrill, height }: { chart: Chart; onDrill: (d: Drill) => void; height?: number }) {
  const horizontal = chart.type === "hbar";
  const multi = chart.series.length > 1;
  const h = height ?? (horizontal ? Math.max(150, chart.categories.length * 30 + (multi ? 50 : 24)) : 240);
  const cat = {
    type: "category" as const,
    data: chart.categories,
    inverse: horizontal,
    axisLine: { lineStyle: { color: "#d6ddd9" } },
    axisTick: { show: false },
    axisLabel: { color: INK.text, fontSize: 11.5, interval: 0, ...(horizontal ? {} : { hideOverlap: false, width: 90, overflow: "break" as const }) },
  };
  const topTarget = Math.max(0, ...(chart.targets ?? []).map((t) => t.value));
  const val = {
    type: "value" as const,
    minInterval: 1,
    splitLine: { lineStyle: { color: INK.grid } },
    axisLabel: { color: INK.axis, fontSize: 11 },
    // keep a target line on the chart even when every bar is below it
    ...(topTarget ? { max: (v: { max: number }) => Math.ceil(Math.max(v.max, topTarget * 1.15)) } : {}),
  };
  const suffix = chart.valueSuffix ?? "";
  const last = chart.series.length - 1;
  return (
    <div>
      <ReactECharts
        style={{ height: h }}
        notMerge
        onEvents={{
          click: (e: { seriesIndex: number; dataIndex: number }) => {
            const d = chart.series[e.seriesIndex]?.drills?.[e.dataIndex];
            if (d) onDrill(d);
          },
        }}
        option={{
          animationDuration: 350,
          tooltip,
          legend: multi ? { top: 0, right: 0, icon: "roundRect", itemWidth: 12, itemHeight: 12, textStyle: { color: INK.text, fontSize: 12 } } : undefined,
          grid: { left: 8, right: horizontal ? 40 : 8, top: multi ? 34 : 14, bottom: 4, containLabel: true },
          xAxis: horizontal ? val : cat,
          yAxis: horizontal ? cat : val,
          series: chart.series.map((s, si) => ({
            name: s.name,
            type: "bar",
            stack: chart.stacked ? "s" : undefined,
            barMaxWidth: horizontal ? 18 : 40,
            barGap: "12%",
            cursor: s.drills ? "pointer" : "default",
            itemStyle: {
              color: s.color,
              borderColor: "#fff",
              borderWidth: chart.stacked ? 1 : 0,
              borderRadius: chart.stacked && si !== last ? 0 : horizontal ? [0, 4, 4, 0] : [4, 4, 0, 0],
            },
            label: {
              show: !chart.stacked || si === last,
              position: horizontal ? "right" : "top",
              color: INK.text,
              fontSize: 11.5,
              fontWeight: 600,
              ...(chart.stacked && si === last
                ? { formatter: (p: { dataIndex: number }) => String(chart.series.reduce((a, x) => a + (x.data[p.dataIndex] ?? 0), 0) || "") }
                : { formatter: (p: { value: number }) => (p.value ? `${p.value}${suffix}` : "") }),
            },
            ...(si === 0 && chart.targets?.length
              ? {
                  markLine: {
                    silent: true,
                    symbol: "none",
                    lineStyle: { type: "dashed" as const, color: "#b4141f", width: 1.5 },
                    label: { position: "insideEndTop" as const, color: "#b4141f", fontSize: 11, fontWeight: 600 },
                    data: chart.targets.map((t) => ({ ...(horizontal ? { xAxis: t.value } : { yAxis: t.value }), label: { formatter: t.label } })),
                  },
                }
              : {}),
            data: s.data.map((v, i) => (s.colors?.[i] ? { value: v, itemStyle: { color: s.colors[i] } } : v)),
          })),
        }}
      />
      {chart.caption ? <div className="faint" style={{ fontSize: 12, marginTop: 4 }}>{chart.caption} · click a bar to open its list</div> : <div className="faint" style={{ fontSize: 12, marginTop: 4 }}>Click a bar to open its list</div>}
    </div>
  );
}
