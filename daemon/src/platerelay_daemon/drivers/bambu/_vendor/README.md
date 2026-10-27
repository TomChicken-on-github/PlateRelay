# 内置的 pybambu

`pybambu/` 原样取自 [ha-bambulab](https://github.com/greghesp/ha-bambulab) 的
`custom_components/bambu_lab/pybambu/`，许可证为 MIT，原文见 [pybambu/LICENSE](pybambu/LICENSE)。

| 项 | 值 |
| --- | --- |
| 上游仓库 | https://github.com/greghesp/ha-bambulab |
| 上游 commit | `0e027ff135a6d9265cb756d3e246747954c76722`（2026-09-21） |
| 本地改动 | 无 |

PyPI 上的 `pybambu` 包最后一次发布是 2024-01，已经跟不上 ha-bambulab，所以按 commit 内置。

## 规则

- 不在 `pybambu/` 里直接改代码。要改行为，在外面包一层（如 `../read_only.py`），这样升级时整目录替换即可。
- 确实要改上游代码时，把改动列进上表的“本地改动”，并保留 MIT 许可证原文。

## 升级

```sh
git clone https://github.com/greghesp/ha-bambulab.git /tmp/ha-bambulab
rm -rf pybambu && cp -r /tmp/ha-bambulab/custom_components/bambu_lab/pybambu pybambu
cp /tmp/ha-bambulab/LICENSE pybambu/LICENSE
```

然后更新上表的 commit，跑 `daemon/` 下的测试。
