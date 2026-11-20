import type { OrderPartsView } from "@platerelay/shared";
import pick from "./pick.png";
import top from "./top.png";

/* Plate 1 of the X2D two-plate fixture: its real top view, pick map and part ids. */
export const mockParts = (): OrderPartsView => ({
  parts: [
    { id: 253, name: "Top-Cover-Cat-v100.stl" },
    { id: 264, name: "Top-Cover-Enclosed-v117.stl" },
    { id: 275, name: "Top-Cover-No-Ears-v100.stl" },
    { id: 308, name: "R4-v117.stl" },
    { id: 319, name: "L3-v117.stl" },
    { id: 330, name: "L4-v117.stl" },
    { id: 341, name: "R3-v117.stl" },
    { id: 396, name: "magnetic-modular-mount-hat.stl" },
    { id: 407, name: "magnetic-chainsaw-hat.stl" },
  ],
  skipped: [],
  topUrl: top,
  pickUrl: pick,
});
