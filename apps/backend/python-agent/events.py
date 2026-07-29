"""
Event Bus - Lightweight pub/sub system for inter-module communication
"""
from typing import Callable, Dict, List, Union, Type
import asyncio
from dataclasses import is_dataclass


class EventBus:
    """Simple event bus for decoupled communication between modules"""

    def __init__(self):
        self._subscribers: Dict[Union[str, Type], List[Callable]] = {}

    def subscribe(self, event_type: Union[str, Type], callback: Callable):
        """
        Subscribe to an event type

        Args:
            event_type: Event type (string or dataclass type)
            callback: Async function to call when event is emitted
        """
        if event_type not in self._subscribers:
            self._subscribers[event_type] = []
        self._subscribers[event_type].append(callback)

    async def emit(self, event_type: Union[str, Type], data: Union[dict, object]):
        """
        Emit an event to all subscribers

        Args:
            event_type: Event type (string or dataclass type)
            data: Event payload (dict or dataclass instance)
        """
        # Support both typed events (dataclass instances) and legacy string events
        if is_dataclass(data) or is_dataclass(type(data)):
            # If data is a dataclass, convert to dict for backward compatibility
            payload = data.to_dict() if hasattr(data, 'to_dict') else data  # type: ignore
        else:
            payload = data
        
        if event_type in self._subscribers:
            # Call all subscribers concurrently
            tasks = [callback(payload) for callback in self._subscribers[event_type]]
            await asyncio.gather(*tasks, return_exceptions=True)
