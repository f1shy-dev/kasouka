type CanvasCommand =
  | "beginPath"
  | ["moveTo", number, number]
  | ["bezierCurveTo", number, number, number, number, number, number]
  | "closePath"
  | "fill";

type CanvasIcon = {
  width: number;
  height: number;
  commands: CanvasCommand[];
};

export const ICONS = {
  github: {
    width: 24,
    height: 24,
    commands: [
      "beginPath",
      ["moveTo", 12, 0.297],
      ["bezierCurveTo", 5.394, 0.297, 0, 5.694, 0, 12.297],
      ["bezierCurveTo", 0, 17.6, 3.438, 22.097, 8.205, 23.682],
      ["bezierCurveTo", 8.805, 23.795, 9.025, 23.424, 9.025, 23.105],
      ["bezierCurveTo", 9.025, 22.82, 9.015, 22.065, 9.01, 21.065],
      ["bezierCurveTo", 5.672, 21.789, 4.968, 19.455, 4.968, 19.455],
      ["bezierCurveTo", 4.421, 18.07, 3.633, 17.7, 3.633, 17.7],
      ["bezierCurveTo", 2.546, 16.956, 3.717, 16.971, 3.717, 16.971],
      ["bezierCurveTo", 4.922, 17.055, 5.555, 18.207, 5.555, 18.207],
      ["bezierCurveTo", 6.625, 20.042, 8.364, 19.512, 9.05, 19.205],
      ["bezierCurveTo", 9.158, 18.429, 9.467, 17.9, 9.81, 17.6],
      ["bezierCurveTo", 7.145, 17.3, 4.344, 16.268, 4.344, 11.67],
      ["bezierCurveTo", 4.344, 10.36, 4.809, 9.29, 5.579, 8.45],
      ["bezierCurveTo", 5.444, 8.147, 5.039, 6.927, 5.684, 5.274],
      ["bezierCurveTo", 5.684, 5.274, 6.689, 4.952, 8.984, 6.504],
      ["bezierCurveTo", 9.944, 6.237, 10.964, 6.105, 11.984, 6.099],
      ["bezierCurveTo", 13.004, 6.105, 14.024, 6.237, 14.984, 6.504],
      ["bezierCurveTo", 17.264, 4.952, 18.269, 5.274, 18.269, 5.274],
      ["bezierCurveTo", 18.914, 6.927, 18.509, 8.147, 18.389, 8.45],
      ["bezierCurveTo", 19.154, 9.29, 19.619, 10.36, 19.619, 11.67],
      ["bezierCurveTo", 19.619, 16.28, 16.814, 17.295, 14.144, 17.59],
      ["bezierCurveTo", 14.564, 17.95, 14.954, 18.686, 14.954, 19.81],
      ["bezierCurveTo", 14.954, 21.416, 14.939, 22.706, 14.939, 23.096],
      ["bezierCurveTo", 14.939, 23.411, 15.149, 23.786, 15.764, 23.666],
      ["bezierCurveTo", 20.565, 22.092, 24, 17.592, 24, 12.297],
      ["bezierCurveTo", 24, 5.694, 18.627, 0.297, 12.03, 0.297],
      "closePath",
      "fill",
    ],
  },
} as const satisfies Record<string, CanvasIcon>;

export const renderIcon = (
  ctx: CanvasRenderingContext2D,
  icon: CanvasIcon,
  x: number,
  y: number,
  size: number
): void => {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(size / icon.width, size / icon.height);
  for (const c of icon.commands) {
    if (c === "beginPath") {
      ctx.beginPath();
    } else if (c === "closePath") {
      ctx.closePath();
    } else if (c === "fill") {
      ctx.fill();
    } else if (c[0] === "moveTo") {
      ctx.moveTo(c[1], c[2]);
    } else if (c[0] === "bezierCurveTo") {
      ctx.bezierCurveTo(c[1], c[2], c[3], c[4], c[5], c[6]);
    }
  }
  ctx.restore();
};
