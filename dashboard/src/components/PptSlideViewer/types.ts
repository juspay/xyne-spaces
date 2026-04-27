export interface Opts {
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  fill?: { color?: string };
  line?: { color?: string };
  rectRadius?: number;
  fontSize?: number;
  color?: string;
  align?: string;
  valign?: string;
  bold?: boolean;
  italic?: boolean;
  charSpacing?: number;
  margin?: number;
  data?: string;
  path?: string;
  paraSpaceAfter?: number;
  bullet?: boolean | { type?: string };
  font?: string;
  fontFace?: string;
  size?: number;
  fontsize?: number;
  textAlign?: string;
  verticalAlign?: string;
}

export interface TextRun {
  text?: string;
  value?: string;
  options?: Opts;
}

export interface ChartSeries {
  name?: string;
  series?: string;
  label?: string;
  labels?: string[];
  categories?: string[];
  values?: number[];
  data?: number[];
}

export interface PptSlideObject {
  type: string;
  text?: string | TextRun[];
  options?: Opts;
  shape?: string;
}

export interface PptSlide {
  index: number;
  background?: { color?: string } | string;
  objects: PptSlideObject[];
}

export interface PptSlideViewerProps {
  attachmentId: string;
  downloadUrl: string;
  filename: string;
  title: string;
  slideCount?: number;
  slides?: PptSlide[];
}
