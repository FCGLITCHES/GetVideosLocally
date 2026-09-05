import { staticFile } from "remotion";

export const FontFaces = () => (
  <style>{`
    @font-face {
      font-family: "Manrope";
      font-style: normal;
      font-weight: 400 800;
      font-display: block;
      src: url("${staticFile("fonts/manrope-latin.woff2")}") format("woff2");
    }
    @font-face {
      font-family: "DM Serif Display";
      font-style: normal;
      font-weight: 400;
      font-display: block;
      src: url("${staticFile("fonts/dm-serif-display-latin.woff2")}") format("woff2");
    }
  `}</style>
);
