// One explicit font for every troika/drei <Text> in the 3D view. Without it troika
// resolves glyphs through its unicode font service, which takes several requests
// and suspends the whole scene while it loads. Inter (OFL) from Google Fonts.
export const SCENE_FONT =
  "https://fonts.gstatic.com/s/inter/v20/UcCO3FwrK3iLTeHuS_nVMrMxCp50SjIw2boKoduKmMEVuGKYAZ9hjg.woff";
