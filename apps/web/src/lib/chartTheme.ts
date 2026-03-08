export const chartTheme = {
  grid: "#253143",
  axis: "#90a0b8",
  tooltipBackground: "#121a27",
  tooltipBorder: "#2d3a4f",
  accentBlue: "#4f8cff",
  accentBlueFill: "#4f8cff",
  accentGreen: "#3dd598",
  accentRed: "#ff6b7d",
  accentAmber: "#ffc857",
  fillOpacity: 0.14,
  barOpacity: 0.72,
};

export const chartTooltipStyle = {
  backgroundColor: chartTheme.tooltipBackground,
  border: `1px solid ${chartTheme.tooltipBorder}`,
  borderRadius: "10px",
};

export const chartTooltipLabelStyle = {
  color: chartTheme.axis,
};

export const chartAxisTick = {
  fontSize: 11,
  fill: chartTheme.axis,
};
