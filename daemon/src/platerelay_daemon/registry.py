"""这个 daemon 带了哪些品牌的适配器。

拓竹的驱动目前只有只读的状态换算，还没接成完整的适配器，所以不在这里；
等用户在场、明确同意对真机发命令时再接。
"""

from __future__ import annotations

from platerelay_daemon.adapter_api import Adapter
from platerelay_daemon.adapters.sim import SimAdapter

ADAPTERS: dict[str, type[Adapter]] = {SimAdapter.brand: SimAdapter}
