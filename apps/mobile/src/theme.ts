export type Palette = {
  background: string;
  surface: string;
  raised: string;
  text: string;
  muted: string;
  line: string;
  accent: string;
  danger: string;
};

export function theme(dark: boolean): Palette {
  return dark
    ? {
        background: "#1c1b19",
        surface: "#242320",
        raised: "#302e2a",
        text: "#f4f2ed",
        muted: "#b3afa6",
        line: "#423f39",
        accent: "#18d3a0",
        danger: "#ff7770",
      }
    : {
        background: "#faf9f6",
        surface: "#ffffff",
        raised: "#f0eee8",
        text: "#292823",
        muted: "#746f65",
        line: "#e1ddd4",
        accent: "#087f5b",
        danger: "#bc3535",
      };
}

export const folderColors = {
  code: "#5a9dd6",
  docs: "#d49b50",
  notes: "#68ad91",
  images: "#8ab46a",
  design: "#ad8bd1",
  media: "#d28798",
  tests: "#69b5b2",
  config: "#91a0b7",
  archive: "#af9980",
  packages: "#c99467",
  people: "#9b8ecb",
  projects: "#709fba",
};
