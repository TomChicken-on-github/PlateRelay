import pytest

from platerelay_daemon.driver_api import NormalizedState as S, Substage as Sub
from platerelay_daemon.drivers.bambu.state_map import map_state, stage_name


@pytest.mark.parametrize(
    ("gcode_state", "stg_cur", "print_error", "expected"),
    [
        ("IDLE", 255, 0, (S.IDLE, None)),
        ("IDLE", -1, 0, (S.IDLE, None)),
        ("INIT", 255, 0, (S.NOT_READY, None)),
        ("PREPARE", 2, 0, (S.PREPARING, Sub.HEATING_BED)),
        ("SLICING", 255, 0, (S.PREPARING, None)),
        ("RUNNING", 0, 0, (S.PRINTING, None)),
        ("RUNNING", 4, 0, (S.PRINTING, Sub.CHANGING_FILAMENT)),
        ("RUNNING", 24, 0, (S.PRINTING, Sub.LOADING_FILAMENT)),
        ("RUNNING", 1, 0, (S.PREPARING, Sub.LEVELING)),
        ("RUNNING", 14, 0, (S.PREPARING, Sub.CLEANING_NOZZLE)),
        ("PAUSE", 16, 0, (S.PAUSED, None)),
        ("PAUSE", 30, 0, (S.PAUSED, None)),
        ("PAUSE", 6, 0, (S.ERROR_PAUSED, None)),
        ("PAUSE", 16, 0x07008006, (S.ERROR_PAUSED, None)),
        ("FINISH", 255, 0, (S.FINISHED, None)),
        ("FAILED", 255, 0, (S.FAILED, None)),
        ("unknown", None, 0, (S.UNKNOWN, None)),
    ],
)
def test_map_state(gcode_state, stg_cur, print_error, expected):
    assert map_state(gcode_state, stg_cur, print_error) == expected


def test_unknown_stage_number_is_other_not_error():
    assert map_state("RUNNING", 999, 0) == (S.PREPARING, Sub.OTHER)
    assert stage_name(999) == "unknown"
