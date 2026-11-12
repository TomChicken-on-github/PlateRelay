"""一台模拟的 3D 打印机。

它是一台独立的设备：有自己的固件状态、自己的局域网接口和自己的词汇，不 import daemon 的任何东西，
也不知道面板的协议。daemon 里的 sim 适配器像对接真机一样，只通过它的局域网接口工作。
"""

from .printer import Refused, SimConfig, SimPrinter
from .server import SimPrinterServer

__all__ = ["Refused", "SimConfig", "SimPrinter", "SimPrinterServer"]
