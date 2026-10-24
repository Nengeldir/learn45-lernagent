Pinned runtime snapshot from OwlYouNeed, commit `18f8e19d6ef4761672ad9cd538caa3287b7751f2`.

Package metadata is adapted for the Learn45 workspace; demos, fixtures, native GPU test dependencies, and the original application are excluded. No runtime dependency on the OwlYouNeed checkout is required.

Local fixes:

- German umlauts in plain text labels are converted to vector math accents in `src/render-geometry.ts`.
- Common Greek letters, scientific operators, degree signs and Unicode sub/superscripts use the bundled math glyphs, so generated labels such as `CO₂` and `πr²` remain renderable.
- `src/webgl.ts` packs contiguous vertex fields into 11 attributes, leaving room for Safari/Metal's internal instancing attribute. The shared vertex buffer and WebGPU layout remain compatible.

OwlYouNeed itself is unchanged.
