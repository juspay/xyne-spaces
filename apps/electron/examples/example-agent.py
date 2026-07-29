"""
Example Python agent demonstrating the Local Agent Authorization Protocol

This script shows how to:
1. Request authorization from the Electron app
2. Handle approval/denial
3. Use the access token to make authenticated requests
4. Release the session when done
"""

import requests
import sys
from typing import Optional

# The Electron app listens on this port
ELECTRON_PORT = 49231
BASE_URL = f"http://127.0.0.1:{ELECTRON_PORT}"


def request_authorization(
    agent_name: str,
    description: str
) -> Optional[str]:
    """
    Request authorization from the Electron app
    
    Returns the access token if approved, None if denied
    """
    try:
        response = requests.post(
            f"{BASE_URL}/auth/request",
            json={
                "agentName": agent_name,
                "agentType": "python-script",
                "description": description
            },
            timeout=60  # Give user time to approve
        )
        
        data = response.json()
        
        if data.get("status") == "approved":
            print(f"✓ Authorization approved!")
            print(f"  Token expires at: {data.get('expiresAt')}")
            return data.get("accessToken")
        elif data.get("status") == "denied":
            print(f"✗ Authorization denied: {data.get('reason')}")
            return None
        else:
            print(f"✗ Unexpected response: {data}")
            return None
            
    except requests.exceptions.ConnectionError:
        print(f"✗ Could not connect to Electron app at {BASE_URL}")
        print("  Make sure the Electron app is running")
        return None
    except Exception as e:
        print(f"✗ Authorization request failed: {e}")
        return None


def interact_with_backend(
    token: str,
    data: Optional[dict] = None
) -> Optional[dict]:
    """
    Make a request to the backend through the Electron app's /interact endpoint
    
    The Electron app will:
    1. Validate your agent token
    2. Retrieve the user's access token from cookies
    3. Make the request to the backend with the user's token
    4. Return the backend response to you
    
    The endpoint and method are configured in the Electron app.
    You only need to provide the data payload.
    """
    try:
        response = requests.post(
            f"{BASE_URL}/interact",
            headers={"Authorization": f"Bearer {token}"},
            json=data or {},
            timeout=30
        )
        
        if response.status_code in [401, 403]:
            error_data = response.json()
            print(f"✗ Authorization failed: {error_data.get('message')}")
            print("  Token may have expired or been revoked")
            return None
        
        if response.status_code >= 400:
            print(f"✗ Request failed with status {response.status_code}")
            print(f"  {response.text}")
            return None
        
        return response.json()
        
    except Exception as e:
        print(f"✗ Request failed: {e}")
        return None


def release_session(token: str) -> None:
    """
    Release the authorization session when done
    """
    try:
        headers = {"Authorization": f"Bearer {token}"}
        response = requests.post(
            f"{BASE_URL}/auth/release",
            headers=headers
        )
        
        if response.status_code == 200:
            print("✓ Session released successfully")
        else:
            print(f"⚠ Failed to release session: {response.json()}")
            
    except Exception as e:
        print(f"⚠ Failed to release session: {e}")


def main():
    """
    Example agent workflow
    """
    print("=" * 60)
    print("Example Python Agent - Authorization Demo")
    print("=" * 60)
    print()
    
    # Step 1: Request authorization
    print("Step 1: Requesting authorization...")
    print("  (Check the Electron app for the consent dialog)")
    print()
    
    token = request_authorization(
        agent_name="Example Python Agent",
        description="Demonstrates the Local Agent Authorization Protocol"
    )
    
    if not token:
        print()
        print("Authorization failed. Exiting.")
        sys.exit(1)
    
    print()
    print("-" * 60)
    print()
    
    # Step 2: Use the token to make requests
    print("Step 2: Making authenticated requests...")
    print()
    
    # Example: Check health endpoint (doesn't require auth)
    print("Testing health endpoint (no auth required):")
    try:
        health = requests.get(f"{BASE_URL}/health").json()
        print(f"  Status: {health.get('status')}")
    except Exception as e:
        print(f"  Failed: {e}")
    
    print()
    
    # Example: Try to access backend through /interact
    print("Testing /interact endpoint (backend proxy with user token):")
    print("  The endpoint and method are configured in the Electron app")
    print("  You only send the data payload")
    
    # Example: Send data to backend
    result = interact_with_backend(
        token=token,
        data={
            "query": "example data",
            "filters": {"status": "active"}
        }
    )
    if result:
        print(f"  Response: {result}")
    else:
        print("  Request failed or backend endpoint not available")
    
    print()
    print("-" * 60)
    print()
    
    # Step 3: Release the session
    print("Step 3: Releasing session...")
    release_session(token)
    
    print()
    print("=" * 60)
    print("Demo complete!")
    print("=" * 60)


if __name__ == "__main__":
    main()
