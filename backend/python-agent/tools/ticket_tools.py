"""
Ticket management tools for AI agent
"""
import asyncio
import logging
import aiohttp
from livekit.agents.llm import function_tool
from .utils import log_tool_latency

logger = logging.getLogger(__name__)


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
        if announce:
            message = (
                f"I've prepared a ticket titled '{title}' for you to review."
                if not assigned_to_name
                else f"I've prepared a ticket titled '{title}' and suggested assigning it to {assigned_to_name}. Please review and confirm."
            )
            await announce(message)

        try:    
            backend_url = room_context.get("backend_url")
            api_key = room_context.get("api_key")
            call_id = room_context.get("call_id")
            board_id = room_context.get("board_id")

            if not backend_url or not api_key:
                return (
                    "I couldn't prepare the ticket because the backend configuration "
                    "is missing. Please contact support."
                )

            if not call_id:
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
            
            logger.info(f"[CreateTicket] Sent ticket creation dialog for: {title}")
            
            # Format response for voice
            assigned_msg = f" to be assigned to {assigned_to_name}" if assigned_to_name else ""
            return (
                f"I've opened the ticket creation dialog with the title '{title}'{assigned_msg}. "
                f"Please review and confirm the details to create the ticket."
            )

        except Exception:
            logger.error("Unexpected error while preparing ticket creation", exc_info=True)
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
        if announce:
            await announce("Let me check your tickets.")
            
        try:
            backend_url = room_context.get("backend_url")
            api_key = room_context.get("api_key")
            call_id = room_context.get("call_id")

            if not backend_url or not api_key:
                return (
                    "I couldn't fetch your tickets because the backend configuration "
                    "is missing. Please contact support."
                )

            if not call_id:
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
                    return "I need to know who is asking. Could you please identify yourself?"
                
                # If only one non-AI participant, use that
                non_ai_participants = {k: v for k, v in participant_map.items() 
                                       if v != "ai-assistant"}
                if len(non_ai_participants) == 1:
                    current_user_id = list(non_ai_participants.values())[0]
                else:
                    participant_names = ", ".join(non_ai_participants.keys())
                    return f"I need to know who is asking. Are you {participant_names}?"

            url = f"{backend_url}/api/transcriptionAgent/{call_id}/my-tickets"
            headers = {
                "x-api-key": api_key,
                "Content-Type": "application/json",
            }
            
            params = {"userId": current_user_id, "limit": "5"}
            if status:
                params["status"] = status.upper()

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
                            return f"You have {count} tickets. Here are the 5 most recent:\n{summary}"
                        else:
                            return f"You have {count} ticket{'s' if count > 1 else ''} assigned:\n{summary}"

                    logger.error(
                        "Get my tickets failed (status=%s)",
                        response.status,
                    )
                    return (
                        "I couldn't fetch your tickets due to a server error. "
                        "Please try again."
                    )

        except asyncio.TimeoutError:
            logger.error("Get my tickets request timed out")
            return "The request timed out. Please try again."

        except Exception:
            logger.error("Unexpected error while getting tickets", exc_info=True)
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
        if announce:
            await announce(f"I'm looking for {user_name} to invite.")

        try:
            backend_url = room_context.get("backend_url")
            api_key = room_context.get("api_key")
            call_id = room_context.get("call_id")

            if not backend_url or not api_key:
                return "I couldn't search for users because the backend configuration is missing."

            if not call_id:
                return "I couldn't search for users because the call ID is missing."
                
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
                async with session.get(
                    url,
                    params=params,
                    headers=headers,
                    timeout=aiohttp.ClientTimeout(total=30),
                ) as response:
                    if response.status != 200:
                        logger.error(f"User search failed (status={response.status})")
                        return "I couldn't find any users. Please try again."
                    
                    result = await response.json()
                    users = result.get("users", [])

                    if not users:
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
                    
                    logger.info(f"[InviteUser] Sent invite action for {len(users)} users matching '{user_name}'")
                    
                    # Format user names for voice response
                    if len(users) == 1:
                        return f"I found {users[0]['name']}. I've opened the invite dialog for you to send the message."
                    else:
                        names = ", ".join(u['name'] for u in users[:3])
                        return f"I found {len(users)} users matching '{user_name}': {names}. I've opened the invite dialog so you can select who to invite."

        except asyncio.TimeoutError:
            logger.error("User search request timed out")
            return "The request timed out. Please try again."

        except Exception:
            logger.error("Unexpected error in invite_user tool", exc_info=True)
            return "I encountered an error. Please try again."

    return invite_user
