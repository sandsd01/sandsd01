const IN_COLOR = '#22c55e'
const OUT_COLOR = '#ef4444'

export function MovementsChart({ data }) {
  const width = 640
  const height = 200
  const padding = 24
  const max = Math.max(1, ...data.map((d) => Math.max(d.in, d.out)))
  const chartHeight = height - padding * 2
  const groupWidth = (width - padding * 2) / data.length
  const barWidth = Math.max(2, groupWidth / 2 - 2)

  return (
    <div className="chart-wrapper">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Stock movements by day">
        <line
          x1={padding}
          y1={height - padding}
          x2={width - padding}
          y2={height - padding}
          stroke="var(--border)"
        />
        {data.map((d, i) => {
          const x = padding + i * groupWidth
          const inHeight = (d.in / max) * chartHeight
          const outHeight = (d.out / max) * chartHeight
          return (
            <g key={d.date}>
              <rect
                x={x}
                y={height - padding - inHeight}
                width={barWidth}
                height={inHeight}
                fill={IN_COLOR}
              >
                <title>{`${d.date} — in: ${d.in}`}</title>
              </rect>
              <rect
                x={x + barWidth + 2}
                y={height - padding - outHeight}
                width={barWidth}
                height={outHeight}
                fill={OUT_COLOR}
              >
                <title>{`${d.date} — out: ${d.out}`}</title>
              </rect>
            </g>
          )
        })}
      </svg>
      <div className="chart-legend">
        <span>
          <span className="chart-swatch" style={{ background: IN_COLOR }} /> Stock in
        </span>
        <span>
          <span className="chart-swatch" style={{ background: OUT_COLOR }} /> Stock out
        </span>
        <span className="chart-range">
          {data[0]?.date} – {data[data.length - 1]?.date}
        </span>
      </div>
    </div>
  )
}
