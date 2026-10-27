import { DEFAULT_RESOURCE_SETTINGS, type ResourceSettings, type ResourcesView } from "@platerelay/shared";
import { createStore } from "../lib/store";

/* 本场可用资源 as the printers would report it; settings below hide, annotate and add stock to it. */
export const reported: ResourcesView = {
  show: true,
  bulletin: "",
  colourMissing: "warn",
  models: [
    { modelId: "N6", model: "X2D", count: 2, idle: 1, nozzles: [0.4], dual: true, bedTypes: ["Textured PEI Plate"], wait: "30m-1h", waitManual: false, note: "", hidden: false },
    { modelId: "O1D", model: "H2D", count: 1, idle: 0, nozzles: [0.4], dual: true, bedTypes: ["Textured PEI Plate"], wait: "1h-2h", waitManual: false, note: "", hidden: false },
    { modelId: "C12", model: "P1S", count: 4, idle: 2, nozzles: [0.4], dual: false, bedTypes: ["Cool Plate", "Textured PEI Plate"], wait: "lt30m", waitManual: false, note: "", hidden: false },
  ],
  materials: [
    { type: "PLA", note: "", hidden: false, colors: [["#f4f4f4", "白"], ["#1d1d1f", "黑"], ["#8e8e93", "灰"], ["#e5383b", "红"], ["#ffcc00", "黄"], ["#0088ff", "蓝"]].map(([color]) => ({ color, name: null, stock: false, modelIds: ["N6", "O1D", "C12"] })) },
    { type: "PETG", note: "", hidden: false, colors: [{ color: "#1d1d1f", name: null, stock: false, modelIds: ["N6", "O1D"] }] },
    { type: "TPU", note: "", hidden: false, colors: [] },
    { type: "ABS", note: "", hidden: false, colors: [{ color: "#1d1d1f", name: null, stock: false, modelIds: ["N6"] }] },
  ],
};

export const resourceSettings = createStore<ResourceSettings>({
  ...DEFAULT_RESOURCE_SETTINGS,
  bulletin: "现场换料约 10 分钟。TPU 等特殊耗材请先找工作人员确认。",
  models: { N6: { note: "双色或双材料优先切这台" }, O1D: { note: "只有 0.4 mm 喷嘴" }, C12: { note: "只用一个喷嘴的模型请切这台" } },
  materials: { PETG: { note: "P1S 不开放 PETG" }, TPU: { note: "提交前先找工作人员确认" }, ABS: { hidden: true } },
  stock: [
    { id: "s1", type: "PLA", color: "#ff8d28", name: "橙", modelIds: ["N6", "O1D", "C12"] },
    { id: "s2", type: "PETG", color: "#f4f4f4", name: "白", modelIds: ["N6", "O1D"] },
    { id: "s3", type: "TPU", color: "#1d1d1f", name: "黑", modelIds: ["N6"] },
  ],
});
