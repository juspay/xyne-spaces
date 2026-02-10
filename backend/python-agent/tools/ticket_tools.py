"""
Ticket management tools for AI agent
"""
import asyncio
import logging
import aiohttp
from livekit.agents.llm import function_tool
from .utils import log_tool_latency
from config import get_logger

logger = get_logger(__name__)


def create_ticket_creation_tool(room_context: dict, event_emitter):
    """
    Factory function to create a ticket creation tool with room context.
    
    Args:
        room_context: Room context dict with backend_url, api_key, call_id
        event_emitter: Async function to emit events (event_bus.emit)
    """

    @function_tool()
    @log_tool_latency
    async def create_ticket(
        title: str,
        description: str,
        assigned_to_name: str | None = None,
    ) -> str:
        """
        Prepare a ticket creation request and show it to the user for confirmation.
        Use this when a user asks to create a ticket, task, or issue.
        
        Args:
            title: The title/summary of the ticket
            description: Detailed description of the ticket
            assigned_to_name: Optional name of the person to assign the ticket to
        
        Returns:
            Confirmation that the ticket creation dialog was shown to the user
        """
        
        announce = room_context.get("announce_tool")
        call_id = room_context.get("call_id", "unknown")
        if announce:
            message = (
                f"I've prepared a ticket titled '{title}' for you to review."
                if not assigned_to_name
                else f"I've prepared a ticket titled '{title}' and suggested assigning it to {assigned_to_name}. Please review and confirm."
            )
            await announce(message)
            logger.info(f"tool_execution_announcement_sent | tool=create_ticket, message_preview={message[:50]}")

        try:    
            backend_url = room_context.get("backend_url")
            api_key = room_context.get("api_key")
            board_id = room_context.get("board_id")

            if not backend_url or not api_key:
                logger.error(f"tool_config_missing | tool=create_ticket, missing_fields={'backend_url' if not backend_url else 'api_key'}")
                return (
                    "I couldn't prepare the ticket because the backend configuration "
                    "is missing. Please contact support."
                )

            if call_id == "unknown":
                logger.error(f"tool_config_missing | tool=create_ticket, missing_fields=call_id")
                return (
                    "I couldn't prepare the ticket because the call ID is missing. "
                    "Please contact support."
                )

            # Send CREATE_TICKET action event to frontend via LiveKit data channel
            create_ticket_action = {
                "type": "AI_ACTION",
                "action": "CREATE_TICKET",
                "data": {
                    "title": title,
                    "description": description,
                    **({"assignedToName": assigned_to_name} if assigned_to_name else {}),
                    **({"boardId": board_id} if board_id else {}),
                }
            }
            
            # Emit event to frontend
            await event_emitter("AI_ACTION", create_ticket_action)
            logger.info(f"tool_action_event_emitted | tool=create_ticket, action=CREATE_TICKET")

            logger.info(f"tool_create_ticket_started | title_preview={title[:50]}, board_id={board_id}, assigned_to={assigned_to_name}")
            
            # Format response for voice
            assigned_msg = f" to be assigned to {assigned_to_name}" if assigned_to_name else ""
            return (
                f"I've opened the ticket creation dialog with the title '{title}'{assigned_msg}. "
                f"Please review and confirm the details to create the ticket."
            )

        except Exception as e:
            logger.error(f"tool_create_ticket_failed | error={str(e)[:100]}", exc_info=True)
            return (
                "I encountered an unexpected error while preparing the ticket. "
                "Please try again."
            )

    return create_ticket


def create_get_my_tickets_tool(room_context: dict):
    """
    Factory function to create a tool for getting tickets assigned to the current speaker.
    """

    @function_tool()
    @log_tool_latency
    async def get_my_tickets(
        status: str | None = None,
    ) -> str:
        """
        Get tickets assigned to the user who is currently speaking.
        Use this when a user asks about their tickets, tasks, or assignments.
        
        Args:
            status: Optional filter by ticket status (e.g., "NEW", "IN_PROGRESS", "DONE")
        
        Returns:
            A summary of the user's assigned tickets
        """
        announce = room_context.get("announce_tool")
        call_id = room_context.get("call_id", "unknown")
        if announce:
            await announce("Let me check your tickets.")
            logger.info(f"tool_execution_announcement_sent | tool=get_my_tickets, message='Let me check your tickets.'")

        try:
            backend_url = room_context.get("backend_url")
            api_key = room_context.get("api_key")

            if not backend_url or not api_key:
                logger.error(f"tool_config_missing | tool=get_my_tickets, missing_fields={'backend_url' if not backend_url else 'api_key'}")
                return (
                    "I couldn't fetch your tickets because the backend configuration "
                    "is missing. Please contact support."
                )

            if call_id == "unknown":
                logger.error(f"tool_config_missing | tool=get_my_tickets, missing_fields=call_id")
                return (
                    "I couldn't fetch your tickets because the call ID is missing. "
                    "Please contact support."
                )

            # Get the current speaker's userId from participant_map
            # The tool context should provide the current speaker from the transcript
            # For now, we'll need the userId to be passed via the tool context
            # The participant_map maps name -> identity (which IS the userId)
            participant_map = room_context.get("participant_map", {})
            
            # Get calling user's identity - this will be set by the session manager
            # based on who asked the question
            current_user_id = room_context.get("current_speaker_id")
            
            if not current_user_id:
                # If we don't have current speaker, list all participants
                if not participant_map:
                    logger.warning(f"tool_user_identity_unknown | tool=get_my_tickets, reason=no_participant_map")
                    return "I need to know who is asking. Could you please identify yourself?"
                
                # If only one non-AI participant, use that
                non_ai_participants = {k: v for k, v in participant_map.items()
                                       if v != "ai-assistant"}
                if len(non_ai_participants) == 1:
                    current_user_id = list(non_ai_participants.values())[0]
                else:
                    participant_names = ", ".join(non_ai_participants.keys())
                    logger.warning(f"tool_user_identity_unknown | tool=get_my_tickets, reason=multiple_participants, participants={list(non_ai_participants.keys())}")
                    return f"I need to know who is asking. Are you {participant_names}?"

            url = f"{backend_url}/api/transcriptionAgent/{call_id}/my-tickets"
            headers = {
                "x-api-key": api_key,
                "Content-Type": "application/json",
            }
            
            params = {"userId": current_user_id, "limit": "5"}
            if status:
                params["status"] = status.upper()
            
            logger.info(f"tool_get_tickets_started | requester_id={current_user_id}, status_filter={status}")

            async with aiohttp.ClientSession() as session:
                async with session.get(
                    url,
                    params=params,
                    headers=headers,
                    timeout=aiohttp.ClientTimeout(total=30),
                ) as response:
                    if response.status == 200:
                        result = await response.json()
                        tickets = result.get("tickets", [])
                        count = result.get("count", 0)

                        if count == 0:
                            return "You don't have any tickets assigned to you right now."

                        # Format tickets for voice response
                        ticket_summaries = []
                        for i, ticket in enumerate(tickets[:5], 1):  # Limit to 5 for voice
                            xyne_id = ticket.get("xyneId", "")
                            title = ticket.get("title", "Untitled")
                            ticket_status = ticket.get("status", "").replace("_", " ").lower()
                            priority = ticket.get("priority", "").lower()
                            ticket_summaries.append(
                                f"{i}. {xyne_id}: {title} - {ticket_status}, {priority} priority"
                            )

                        summary = "\n".join(ticket_summaries)
                        
                        if count > 5:
                            logger.info(f"tool_get_tickets_success | tickets_count={count}, returned=5")
                            return f"You have {count} tickets. Here are the 5 most recent:\n{summary}"
                        else:
                            logger.info(f"tool_get_tickets_success | tickets_count={count}")
                            return f"You have {count} ticket{'s' if count > 1 else ''} assigned:\n{summary}"

                    logger.error(f"tool_get_tickets_failed | status_code={response.status}")
                    return (
                        "I couldn't fetch your tickets due to a server error. "
                        "Please try again."
                    )

        except asyncio.TimeoutError:
            logger.error(f"tool_get_tickets_failed | error=timeout")
            return "The request timed out. Please try again."

        except Exception as e:
            logger.error(f"tool_get_tickets_failed | error={str(e)[:100]}", exc_info=True)
            return "I encountered an error while fetching your tickets. Please try again."

    return get_my_tickets


def create_invite_user_tool(room_context: dict, event_emitter):
    """
    Factory function to create a tool for inviting users to the call.
    This tool searches for users and sends an action event to the frontend.
    
    Args:
        room_context: Room context dict with backend_url, api_key, call_id
        event_emitter: Async function to emit events (event_bus.emit)
    """

    @function_tool()
    @log_tool_latency
    async def invite_user(
        user_name: str,
        message: str | None = None,
    ) -> str:
        """
        Search for a user by name and send an invite action to the frontend.
        Use this when a user asks to invite someone to the meeting/call.
        
        Args:
            user_name: Name of the user to invite (partial match supported)
            message: Optional message to include with the invite
        
        Returns:
            Confirmation that the invite action was sent to the user
        """
        # Announce tool usage
        announce = room_context.get("announce_tool")
        call_id = room_context.get("call_id", "unknown")
        if announce:
            await announce(f"I'm looking for {user_name} to invite.")
            logger.info(f"tool_execution_announcement_sent | tool=invite_user, message='Looking for {user_name}'")

        try:
            backend_url = room_context.get("backend_url")
            api_key = room_context.get("api_key")

            if not backend_url or not api_key:
                logger.error(f"tool_config_missing | tool=invite_user, missing_fields={'backend_url' if not backend_url else 'api_key'}")
                return "I couldn't search for users because the backend configuration is missing."

            if call_id == "unknown":
                logger.error(f"tool_config_missing | tool=invite_user, missing_fields=call_id")
                return "I couldn't search for users because the call ID is missing."
            
            logger.info(f"tool_invite_user_started | search_term={user_name}")
                
            # exclude existing participants from search
            participant_map = room_context.get("participant_map", {})
            existing_participant_ids = list(participant_map.values())

            # Search for users matching the name
            url = f"{backend_url}/api/transcriptionAgent/{call_id}/search-users"
            headers = {
                "x-api-key": api_key,
                "Content-Type": "application/json",
            }
            params = {"q": user_name, "limit": "5"}
            if existing_participant_ids:
                params["excludeUserIds"] = existing_participant_ids

            async with aiohttp.ClientSession() as session:
                logger.debug(f"tool_invite_user_searching | endpoint={url}, search_term={user_name}")
                async with session.get(
                    url,
                    params=params,
                    headers=headers,
                    timeout=aiohttp.ClientTimeout(total=30),
                ) as response:
                    if response.status != 200:
                        logger.error(f"tool_invite_user_failed | status_code={response.status}, search_term={user_name}")
                        return "I couldn't find any users. Please try again."
                    
                    result = await response.json()
                    users = result.get("users", [])

                    if not users:
                        logger.info(f"tool_invite_user_not_found | search_term={user_name}")
                        return f"I couldn't find anyone named '{user_name}'. Please check the name and try again."

                    # Send invite action event to frontend via LiveKit data channel
                    invite_action = {
                        "type": "AI_ACTION",
                        "action": "INVITE_USER",
                        "data": {
                            "users": users,
                            "message": message or "You're invited to join the call",
                            "suggestedMessage": message or "Hi! We'd like you to join our call.",
                        }
                    }
                    
                    # Emit event to frontend
                    await event_emitter("AI_ACTION", invite_action)
                    logger.info(f"tool_action_event_emitted | tool=invite_user, action=INVITE_USER")

                    logger.info(f"tool_invite_user_found | search_term={user_name}, results_count={len(users)}")
                    
                    # Format user names for voice response
                    if len(users) == 1:
                        logger.info(f"tool_invite_user_sent | user_id={users[0].get('id')}, user_name={users[0]['name']}")
                        return f"I found {users[0]['name']}. I've opened the invite dialog for you to send the message."
                    else:
                        names = ", ".join(u['name'] for u in users[:3])
                        return f"I found {len(users)} users matching '{user_name}': {names}. I've opened the invite dialog so you can select who to invite."

        except asyncio.TimeoutError:
            logger.error(f"tool_invite_user_failed | error=timeout, search_term={user_name}")
            return "The request timed out. Please try again."

        except Exception as e:
            logger.error(f"tool_invite_user_failed | error={str(e)[:100]}, search_term={user_name}", exc_info=True)
            return "I encountered an error. Please try again."

    return invite_user
