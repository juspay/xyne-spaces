import time
import functools
import logging
from typing import Callable, Any

logger = logging.getLogger(__name__)

def log_tool_latency(func: Callable[..., Any]) -> Callable[..., Any]:
    """
    Decorator to log the start and completion of a tool invocation, including latency.
    """
    @functools.wraps(func)
    async def wrapper(*args, **kwargs):
        tool_name = func.__name__
        logger.info(f"Tool declared: {tool_name} invoked")
        
        start_time = time.perf_counter()
        try:
            result = await func(*args, **kwargs)
            return result
        finally:
            end_time = time.perf_counter()
            latency = end_time - start_time
            logger.info(f"Tool declared: {tool_name} finished in {latency:.4f}s")
            
    return wrapper
