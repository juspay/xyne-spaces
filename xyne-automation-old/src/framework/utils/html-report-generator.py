#!/usr/bin/env python3
"""
Interactive HTML Report Generator
Generates an interactive HTML report with module navigation, test details, and version comparison
"""

import os
import sys
import json
import requests
from datetime import datetime
from typing import List, Dict, Any, Optional

# Load environment variables from .env file
def load_env_file():
    """Load environment variables from .env file."""
    current_dir = os.path.dirname(os.path.abspath(__file__))
    framework_dir = os.path.dirname(current_dir)
    src_dir = os.path.dirname(framework_dir)
    project_root = os.path.dirname(src_dir)
    env_path = os.path.join(project_root, '.env')

    print(f" Looking for .env file at: {env_path}")

    if os.path.exists(env_path):
        with open(env_path, 'r') as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith('#') and '=' in line:
                    key, value = line.split('=', 1)
                    value = value.strip('\'"')
                    os.environ[key] = value
        print(f" Loaded environment variables from {env_path}")
    else:
        print(f"️ .env file not found at {env_path}")

# Load environment variables at module level
load_env_file()

class SlackNotifier:
    """Simple Slack notifier for HTML reports."""

    def __init__(self):
        """Initialize Slack notifier."""
        self.bot_token = os.environ.get('SLACK_BOT_TOKEN')
        self.channel_id = os.environ.get('SLACK_CHANNEL_ID', 'xyne-automation')
        self.is_enabled = bool(self.bot_token)

        if not self.is_enabled:
            print('️ Slack notifications disabled: SLACK_BOT_TOKEN not found in environment')

    def upload_html_to_slack_thread(self, html_path, cron_run_id, thread_ts=None):
        """Upload HTML report to Slack using files.uploadV2, optionally as a thread reply."""
        if not self.is_enabled:
            print(' Slack notification skipped: Not configured')
            return False

        try:
            headers = {'Authorization': f'Bearer {self.bot_token}'}
            file_size = os.path.getsize(html_path)
            file_name = os.path.basename(html_path)

            if thread_ts:
                print(f' Uploading HTML report to Slack thread: {thread_ts}')
            else:
                print(f' Uploading HTML report to Slack channel: {self.channel_id}')

            # Step 1: Get upload URL
            response = requests.post(
                'https://slack.com/api/files.getUploadURLExternal',
                headers=headers,
                data={'filename': file_name, 'length': file_size},
                timeout=30
            )

            if not response.ok or not response.json().get('ok'):
                error_msg = response.json().get('error', 'Unknown') if response.ok else f'HTTP {response.status_code}'
                print(f' Failed to get upload URL: {error_msg}')
                return False

            upload_data = response.json()
            upload_url = upload_data['upload_url']
            file_id = upload_data['file_id']

            # Step 2: Upload file to the URL
            with open(html_path, 'rb') as file:
                upload_response = requests.post(
                    upload_url,
                    files={'file': (file_name, file, 'text/html')},
                    timeout=60
                )

                if not upload_response.ok:
                    print(f' Failed to upload file: HTTP {upload_response.status_code}')
                    return False

            # Step 3: Complete the upload
            complete_payload = {
                'files': [{'id': file_id, 'title': f'Interactive HTML Report - {cron_run_id}'}],
                'channel_id': self.channel_id,
                'initial_comment': f' Interactive HTML Test Report for CRON Run ID: {cron_run_id}\n\nClick to view detailed test results with module navigation and version comparison.'
            }

            # If thread_ts is provided, upload as a thread reply
            if thread_ts:
                complete_payload['thread_ts'] = thread_ts

            complete_response = requests.post(
                'https://slack.com/api/files.completeUploadExternal',
                headers={**headers, 'Content-Type': 'application/json'},
                json=complete_payload,
                timeout=30
            )

            if complete_response.ok:
                result = complete_response.json()
                if result.get('ok'):
                    print(' HTML report uploaded to Slack successfully')

                    # Try to get the file permalink
                    files = result.get('files', [])
                    if files and files[0].get('permalink'):
                        print(f' Slack file URL: {files[0]["permalink"]}')
                        return files[0]['permalink']

                    return True
                else:
                    print(f' Slack API error: {result.get("error", "Unknown")}')
                    return False
            else:
                print(f' HTTP error completing upload: {complete_response.status_code}')
                return False

        except Exception as e:
            print(f' Exception uploading to Slack: {e}')
            return False

    def find_pdf_message_ts(self, cron_run_id):
        """Find the timestamp of the PDF message for a given CRON_RUN_ID."""
        if not self.is_enabled:
            return None

        try:
            # Use conversations.history to find recent messages
            url = 'https://slack.com/api/conversations.history'

            headers = {
                'Authorization': f'Bearer {self.bot_token}',
                'Content-Type': 'application/json'
            }

            params = {
                'channel': self.channel_id,
                'limit': 20  # Look at last 20 messages
            }

            print(f' Searching for PDF message with CRON_RUN_ID: {cron_run_id}')

            response = requests.get(url, headers=headers, params=params, timeout=30)

            if response.ok:
                result = response.json()
                if result.get('ok'):
                    messages = result.get('messages', [])

                    # Look for a message containing the CRON_RUN_ID
                    for msg in messages:
                        text = msg.get('text', '')
                        if cron_run_id in text and 'PDF' in text:
                            ts = msg.get('ts')
                            print(f' Found PDF message at timestamp: {ts}')
                            return ts

                    print('️ PDF message not found in recent messages')
                    return None
                else:
                    print(f' Slack API error: {result.get("error", "Unknown error")}')
                    return None
            else:
                print(f' HTTP error: {response.status_code} {response.text}')
                return None

        except Exception as e:
            print(f' Exception finding PDF message: {e}')
            return None

class InteractiveHtmlReportGenerator:
    def __init__(self):
        """Initialize the HTML report generator."""
        self.auth_token = None

    def authenticate_with_juspay(self):
        """Get authentication token using Juspay API."""
        try:
            # Use same login URL as PDF generator for consistency
            login_url = os.environ.get('LOGIN_API_ENDPOINT',
                                      'https://roaming.sandbox.portal.juspay.in/api/ec/v1/admin/login')

            username = os.environ.get('JUSPAY_USERNAME')
            password = os.environ.get('JUSPAY_PASSWORD')

            if not username or not password:
                raise Exception('Missing JUSPAY_USERNAME or JUSPAY_PASSWORD environment variables')

            login_payload = {
                'username': username,
                'password': password
            }

            print(f" Authenticating with Juspay API...")

            response = requests.post(login_url, json=login_payload, timeout=30)

            if not response.ok:
                raise Exception(f'Authentication failed: {response.status_code} {response.text}')

            login_data = response.json()
            token = login_data.get('token')

            if not token:
                raise Exception('Token not found in login response')

            print(' Successfully obtained authentication token')
            self.auth_token = token
            return token

        except Exception as e:
            print(f' Authentication error: {e}')
            raise

    def execute_query(self, query: str) -> Dict[str, Any]:
        """Execute a database query."""
        try:
            if not self.auth_token:
                self.authenticate_with_juspay()

            db_endpoint = os.getenv('DB_API_ENDPOINT',
                                    'https://sandbox.portal.juspay.in/dashboard-test-automation/dbQuery')

            response = requests.get(
                db_endpoint,
                headers={
                    'x-web-logintoken': self.auth_token,
                    'Content-Type': 'application/json'
                },
                json={'query': query},
                timeout=60  # Increased timeout to 60 seconds
            )

            if not response.ok:
                raise Exception(f'Database query failed: {response.status_code} {response.text}')

            result = response.json()
            return result

        except Exception as e:
            print(f' Error executing query: {e}')
            raise

    def fetch_current_run_data(self, cron_run_id: str) -> List[Dict[str, Any]]:
        """Fetch current test run data from xyne_test_module table with detailed test info."""
        try:
            print(f' Fetching current run data for CRON_RUN_ID: {cron_run_id}')

            # Query xyne_test_module for detailed test data from JSONB with run metadata
            query = f"""
                SELECT
                    m.module_name,
                    m.run_data,
                    m.started_at,
                    m.completed_at,
                    m.slack_report_link,
                    r.run_env as runenv,
                    r.run_by as username
                FROM xyne_test_module m
                LEFT JOIN xyne_test_runs r ON m.cron_run_id = r.cron_run_id
                WHERE m.cron_run_id = '{cron_run_id}'
                ORDER BY m.module_name
            """

            result = self.execute_query(query)

            if result.get('response') and len(result['response']) > 0:
                response_data = result['response']
                if isinstance(response_data, list) and len(response_data) > 0:
                    print(f' Found {len(response_data)} modules with detailed test data')
                    # Parse the JSONB run_data field
                    parsed_modules = []
                    for module in response_data:
                        # run_data contains the JSONB with tests array
                        run_data = module.get('run_data', {})
                        if isinstance(run_data, str):
                            import json
                            run_data = json.loads(run_data)

                        tests = run_data.get('tests', [])

                        # Calculate summary stats from tests
                        test_cases_run = len(tests)
                        test_cases_passed = sum(1 for t in tests if t.get('status') == 'passed')
                        test_cases_failed = sum(1 for t in tests if t.get('status') == 'failed')
                        test_cases_skipped = sum(1 for t in tests if t.get('status') == 'skipped')

                        # Count failed by priority
                        highest_priority_failed = sum(1 for t in tests if t.get('status') == 'failed' and t.get('priority') == 'highest')
                        high_priority_failed = sum(1 for t in tests if t.get('status') == 'failed' and t.get('priority') == 'high')
                        medium_priority_failed = sum(1 for t in tests if t.get('status') == 'failed' and t.get('priority') == 'medium')
                        low_priority_failed = sum(1 for t in tests if t.get('status') == 'failed' and t.get('priority') == 'low')

                        parsed_module = {
                            'module_name': module.get('module_name'),
                            'test_cases_run': test_cases_run,
                            'test_cases_passed': test_cases_passed,
                            'test_cases_failed': test_cases_failed,
                            'test_cases_skipped': test_cases_skipped,
                            'highest_priority_failed': highest_priority_failed,
                            'high_priority_failed': high_priority_failed,
                            'medium_priority_failed': medium_priority_failed,
                            'low_priority_failed': low_priority_failed,
                            'slack_report_link': module.get('slack_report_link'),
                            'started_at': module.get('started_at'),
                            'completed_at': module.get('completed_at'),
                            'runenv': module.get('runenv'),  # Environment from xyne_test_runs
                            'username': module.get('username'),  # User from xyne_test_runs
                            'tests': tests  # Include detailed test data
                        }
                        parsed_modules.append(parsed_module)

                    return parsed_modules

            return []

        except Exception as e:
            print(f' Error fetching current run data: {e}')
            import traceback
            traceback.print_exc()
            return []

    def fetch_previous_run_data(self, current_run_id: str) -> Optional[List[Dict[str, Any]]]:
        """Fetch previous test run data for comparison based on version tracking."""
        try:
            print(f' Fetching previous run data for comparison...')

            # Get the current run's previous_run_id (which is set during initialization)
            query = f"""
                SELECT previous_run_id, previous_version, repo_version
                FROM xyne_test_runs
                WHERE cron_run_id = '{current_run_id}'
            """

            result = self.execute_query(query)

            if result.get('response') and len(result['response']) > 0:
                response_data = result['response']
                if isinstance(response_data, list) and len(response_data) > 0:
                    first_item = response_data[0]
                    if isinstance(first_item, dict):
                        prev_run_id = first_item.get('previous_run_id')
                        prev_version = first_item.get('previous_version')
                        current_version = first_item.get('repo_version')

                        if not prev_run_id:
                            print('️  No previous run to compare (this might be the first run)')
                            return None

                        print(f' Current version: {current_version}')
                        print(f' Previous version: {prev_version}')
                        print(f' Comparing with previous run ID: {prev_run_id}')

                        # Fetch previous run data with detailed tests
                        prev_query = f"""
                            SELECT
                                module_name,
                                run_data,
                                started_at,
                                completed_at
                            FROM xyne_test_module
                            WHERE cron_run_id = '{prev_run_id}'
                            ORDER BY module_name
                        """

                        prev_result = self.execute_query(prev_query)

                        if prev_result.get('response') and len(prev_result['response']) > 0:
                            prev_data = prev_result['response']
                            if isinstance(prev_data, list) and len(prev_data) > 0:
                                # Parse the JSONB run_data field
                                parsed_prev_modules = []
                                for module in prev_data:
                                    run_data = module.get('run_data', {})
                                    if isinstance(run_data, str):
                                        import json
                                        run_data = json.loads(run_data)

                                    tests = run_data.get('tests', [])

                                    # Calculate summary stats
                                    test_cases_run = len(tests)
                                    test_cases_passed = sum(1 for t in tests if t.get('status') == 'passed')
                                    test_cases_failed = sum(1 for t in tests if t.get('status') == 'failed')
                                    test_cases_skipped = sum(1 for t in tests if t.get('status') == 'skipped')

                                    parsed_prev_module = {
                                        'module_name': module.get('module_name'),
                                        'test_cases_run': test_cases_run,
                                        'test_cases_passed': test_cases_passed,
                                        'test_cases_failed': test_cases_failed,
                                        'test_cases_skipped': test_cases_skipped,
                                        'started_at': module.get('started_at'),
                                        'completed_at': module.get('completed_at'),
                                        'tests': tests  # Include tests for detailed comparison
                                    }
                                    parsed_prev_modules.append(parsed_prev_module)

                                print(f' Found {len(parsed_prev_modules)} modules in previous run')
                                return parsed_prev_modules

            print('️  No previous run found')
            return None

        except Exception as e:
            print(f'️  Error fetching previous run data: {e}')
            import traceback
            traceback.print_exc()
            return None

    def generate_html_report(self, cron_run_id: str, output_path: str = None) -> Optional[str]:
        """Generate interactive HTML report."""
        try:
            print(f' Generating interactive HTML report for CRON_RUN_ID: {cron_run_id}')

            # Fetch current run data
            current_data = self.fetch_current_run_data(cron_run_id)
            if not current_data:
                print('️ No data found for current run')
                return None

            # Fetch version info for the current run
            version_query = f"""
                SELECT repo_version, previous_version, previous_run_id
                FROM xyne_test_runs
                WHERE cron_run_id = '{cron_run_id}'
            """
            version_result = self.execute_query(version_query)
            current_version = 'N/A'
            previous_version = None
            previous_run_id = None

            if version_result.get('response') and len(version_result['response']) > 0:
                version_data = version_result['response'][0]
                if isinstance(version_data, dict):
                    current_version = version_data.get('repo_version', 'N/A')
                    previous_version = version_data.get('previous_version')
                    previous_run_id = version_data.get('previous_run_id')

            # Fetch previous run data for comparison
            previous_data = self.fetch_previous_run_data(cron_run_id)

            # Create comparison map
            prev_map = {}
            if previous_data:
                for module in previous_data:
                    prev_map[module['module_name']] = module

            # Generate output path if not provided
            if not output_path:
                timestamp = datetime.now().strftime('%Y-%m-%d_%H-%M-%S')
                output_path = f'reports/test-execution-report-{cron_run_id}-{timestamp}.html'

            # Ensure reports directory exists
            os.makedirs(os.path.dirname(output_path), exist_ok=True)

            # Generate HTML with version info
            html_content = self.create_html(cron_run_id, current_data, prev_map, current_version, previous_version, previous_run_id)

            # Write to file
            with open(output_path, 'w', encoding='utf-8') as f:
                f.write(html_content)

            print(f' HTML report generated successfully: {output_path}')
            return output_path

        except Exception as e:
            print(f' Error generating HTML report: {e}')
            import traceback
            traceback.print_exc()
            return None

    def generate_test_list_html(self, module: Dict[str, Any], prev_module: Optional[Dict[str, Any]]) -> str:
        """Generate HTML table for individual test cases with timing comparison."""
        tests = module.get('tests', [])

        if not tests:
            return '<p style="color: #6c757d; font-style: italic;">No test data available</p>'

        # Create a map of previous tests for comparison
        prev_tests_map = {}
        if prev_module:
            for test in prev_module.get('tests', []):
                # Try both 'name' and 'title' fields
                test_name = test.get('name', test.get('title', ''))
                prev_tests_map[test_name] = test

        # Start table
        html = '''
        <table class="test-table">
            <thead>
                <tr>
                    <th>Test Case</th>
                    <th>Status</th>
                    <th>Priority</th>
                    <th>Current Time</th>
                    <th>Previous Time</th>
                    <th>Time Diff</th>
                </tr>
            </thead>
            <tbody>
        '''

        for test in tests:
            # Try both 'name' and 'title' fields
            test_name = test.get('name', test.get('title', 'Unknown Test'))
            status = test.get('status', 'unknown')
            priority = test.get('priority', 'medium')
            # Try both 'duration_ms' and 'duration' fields
            duration = test.get('duration_ms', test.get('duration', 0))

            # Format current duration
            current_time = f"{duration / 1000:.2f}s" if duration else "N/A"

            # Get previous test timing
            prev_test = prev_tests_map.get(test_name)
            prev_time = "N/A"
            time_diff_html = '<span class="time-diff-na">N/A</span>'

            if prev_test:
                # Try both 'duration_ms' and 'duration' fields
                prev_duration = prev_test.get('duration_ms', prev_test.get('duration', 0))
                if prev_duration:
                    prev_time = f"{prev_duration / 1000:.2f}s"

                    if duration and prev_duration:
                        time_diff = duration - prev_duration
                        time_diff_str = f"{abs(time_diff) / 1000:.2f}s"
                        percent_change = ((time_diff / prev_duration) * 100) if prev_duration > 0 else 0

                        if time_diff > 0:
                            time_diff_html = f'<span class="time-diff-worse">+{time_diff_str} ({percent_change:.1f}%)</span>'
                        elif time_diff < 0:
                            time_diff_html = f'<span class="time-diff-better">-{time_diff_str} ({abs(percent_change):.1f}%)</span>'
                        else:
                            time_diff_html = f'<span class="time-diff-same">0s (0%)</span>'

            html += f'''
                <tr class="test-row {status}">
                    <td class="test-name-col">{test_name}</td>
                    <td><span class="badge status-{status}">{status}</span></td>
                    <td><span class="badge priority-{priority}">{priority}</span></td>
                    <td class="time-col">{current_time}</td>
                    <td class="time-col">{prev_time}</td>
                    <td class="time-diff-col">{time_diff_html}</td>
                </tr>
            '''

        html += '''
            </tbody>
        </table>
        '''

        return html

    def create_html(self, cron_run_id: str, modules: List[Dict[str, Any]], prev_map: Dict[str, Any],
                    current_version: str = 'N/A', previous_version: str = None, previous_run_id: str = None) -> str:
        """Create the HTML content with version comparison info."""

        # Calculate overall stats
        total_tests = sum(m.get('test_cases_run', 0) for m in modules)
        total_passed = sum(m.get('test_cases_passed', 0) for m in modules)
        total_failed = sum(m.get('test_cases_failed', 0) for m in modules)
        total_skipped = sum(m.get('test_cases_skipped', 0) for m in modules)
        pass_rate = round((total_passed / total_tests) * 100) if total_tests > 0 else 0

        # Use passed version or fallback to env
        repo_version = current_version if current_version != 'N/A' else os.getenv('REPO_VERSION', 'N/A')
        run_env = modules[0].get('runenv', 'Unknown') if modules else 'Unknown'

        # Build comparison info text
        comparison_info = ''
        if previous_version and previous_run_id:
            comparison_info = f' | Comparing with: {previous_version} (Run: {previous_run_id})'
        elif prev_map:
            comparison_info = ' | Comparing with: Previous Run'

        html = f'''<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Test Execution Report - {cron_run_id}</title>
    <style>
        * {{
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }}

        body {{
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            padding: 20px;
            min-height: 100vh;
        }}

        .container {{
            max-width: 1200px;
            margin: 0 auto;
            background: white;
            border-radius: 16px;
            box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
            overflow: hidden;
        }}

        .header {{
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            padding: 40px;
            text-align: center;
        }}

        .header h1 {{
            font-size: 32px;
            font-weight: 700;
            margin-bottom: 10px;
        }}

        .header .meta {{
            opacity: 0.9;
            font-size: 14px;
        }}

        .summary {{
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
            gap: 20px;
            padding: 30px;
            background: #f8f9fa;
        }}

        .summary-card {{
            background: white;
            padding: 20px;
            border-radius: 12px;
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
            text-align: center;
        }}

        .summary-card .label {{
            font-size: 12px;
            color: #6c757d;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            margin-bottom: 8px;
        }}

        .summary-card .value {{
            font-size: 28px;
            font-weight: 700;
            color: #212529;
        }}

        .summary-card.passed .value {{ color: #28a745; }}
        .summary-card.failed .value {{ color: #dc3545; }}
        .summary-card.skipped .value {{ color: #ffc107; }}

        .modules {{
            padding: 30px;
        }}

        .modules h2 {{
            font-size: 24px;
            margin-bottom: 20px;
            color: #212529;
        }}

        .module-card {{
            background: white;
            border: 2px solid #e9ecef;
            border-radius: 12px;
            margin-bottom: 15px;
            overflow: hidden;
            transition: all 0.3s ease;
            cursor: pointer;
        }}

        .module-card:hover {{
            border-color: #667eea;
            box-shadow: 0 4px 12px rgba(102, 126, 234, 0.2);
        }}

        .module-header {{
            padding: 20px;
            display: flex;
            justify-content: space-between;
            align-items: center;
            background: #f8f9fa;
        }}

        .module-header.expanded {{
            background: #667eea;
            color: white;
        }}

        .module-name {{
            font-size: 18px;
            font-weight: 600;
            display: flex;
            align-items: center;
            gap: 10px;
        }}

        .module-stats {{
            display: flex;
            gap: 20px;
            font-size: 14px;
        }}

        .stat {{
            display: flex;
            flex-direction: column;
            align-items: center;
        }}

        .stat-label {{
            font-size: 11px;
            opacity: 0.7;
            text-transform: uppercase;
        }}

        .stat-value {{
            font-weight: 700;
            font-size: 16px;
        }}

        .stat.passed {{ color: #28a745; }}
        .stat.failed {{ color: #dc3545; }}
        .stat.skipped {{ color: #ffc107; }}

        .module-details {{
            display: none;
            padding: 20px;
            background: white;
            border-top: 2px solid #e9ecef;
        }}

        .module-details.active {{
            display: block;
            animation: slideDown 0.3s ease;
        }}

        @keyframes slideDown {{
            from {{
                opacity: 0;
                transform: translateY(-10px);
            }}
            to {{
                opacity: 1;
                transform: translateY(0);
            }}
        }}

        .comparison {{
            background: #fff3cd;
            border-left: 4px solid #ffc107;
            padding: 15px;
            margin-bottom: 20px;
            border-radius: 8px;
        }}

        .comparison-title {{
            font-weight: 600;
            margin-bottom: 10px;
            color: #856404;
        }}

        .comparison-stats {{
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
            gap: 10px;
        }}

        .comparison-item {{
            display: flex;
            justify-content: space-between;
            font-size: 14px;
        }}

        .comparison-change {{
            font-weight: 600;
        }}

        .comparison-change.better {{ color: #28a745; }}
        .comparison-change.worse {{ color: #dc3545; }}
        .comparison-change.same {{ color: #6c757d; }}

        .test-list {{
            margin-top: 20px;
        }}

        .test-item {{
            padding: 12px;
            border-left: 4px solid #e9ecef;
            margin-bottom: 8px;
            background: #f8f9fa;
            border-radius: 4px;
        }}

        .test-item.passed {{ border-left-color: #28a745; background: #d4edda; }}
        .test-item.failed {{ border-left-color: #dc3545; background: #f8d7da; }}
        .test-item.skipped {{ border-left-color: #ffc107; background: #fff3cd; }}

        .test-name {{
            font-weight: 600;
            margin-bottom: 5px;
        }}

        .test-meta {{
            font-size: 12px;
            color: #6c757d;
            display: flex;
            gap: 15px;
        }}

        .badge {{
            display: inline-block;
            padding: 4px 8px;
            border-radius: 12px;
            font-size: 11px;
            font-weight: 600;
            text-transform: uppercase;
        }}

        .badge.status-passed {{ background: #28a745; color: white; }}
        .badge.status-failed {{ background: #dc3545; color: white; }}
        .badge.status-skipped {{ background: #ffc107; color: #212529; }}

        .badge.priority-highest {{ background: #dc3545; color: white; }}
        .badge.priority-high {{ background: #fd7e14; color: white; }}
        .badge.priority-medium {{ background: #ffc107; color: #212529; }}
        .badge.priority-low {{ background: #6c757d; color: white; }}

        .slack-link {{
            display: inline-block;
            padding: 8px 16px;
            background: #4A154B;
            color: white;
            text-decoration: none;
            border-radius: 6px;
            font-size: 14px;
            margin-top: 10px;
        }}

        .slack-link:hover {{
            background: #611f69;
        }}

        .footer {{
            background: #212529;
            color: white;
            text-align: center;
            padding: 20px;
            font-size: 12px;
        }}

        .status-icon {{
            width: 20px;
            height: 20px;
            border-radius: 50%;
            display: inline-block;
        }}

        .status-icon.passed {{ background: #28a745; }}
        .status-icon.failed {{ background: #dc3545; }}
        .status-icon.partial {{ background: #ffc107; }}

        .chevron {{
            transition: transform 0.3s ease;
        }}

        .chevron.rotated {{
            transform: rotate(180deg);
        }}

        .timing-diff {{
            font-size: 12px;
            font-weight: 600;
            padding: 2px 8px;
            border-radius: 4px;
            margin-left: 5px;
        }}

        .timing-diff.better {{
            color: #28a745;
            background: #d4edda;
        }}

        .timing-diff.worse {{
            color: #dc3545;
            background: #f8d7da;
        }}

        .timing-diff.same {{
            color: #6c757d;
            background: #e9ecef;
        }}

        .test-table {{
            width: 100%;
            border-collapse: collapse;
            margin-top: 10px;
            font-size: 13px;
        }}

        .test-table thead {{
            background: #667eea;
            color: white;
        }}

        .test-table th {{
            padding: 12px 8px;
            text-align: left;
            font-weight: 600;
            border: 1px solid #ddd;
        }}

        .test-table td {{
            padding: 10px 8px;
            border: 1px solid #ddd;
            vertical-align: middle;
        }}

        .test-row.passed {{
            background: #f0fff4;
        }}

        .test-row.failed {{
            background: #fff5f5;
        }}

        .test-row.skipped {{
            background: #fffef0;
        }}

        .test-row:hover {{
            background: #f8f9fa;
        }}

        .test-name-col {{
            font-weight: 500;
            max-width: 400px;
            word-wrap: break-word;
        }}

        .time-col {{
            text-align: center;
            font-family: 'Courier New', monospace;
            font-weight: 600;
            color: #495057;
        }}

        .time-diff-col {{
            text-align: center;
        }}

        .time-diff-better {{
            color: #28a745;
            font-weight: 700;
            background: #d4edda;
            padding: 4px 8px;
            border-radius: 4px;
            display: inline-block;
        }}

        .time-diff-worse {{
            color: #dc3545;
            font-weight: 700;
            background: #f8d7da;
            padding: 4px 8px;
            border-radius: 4px;
            display: inline-block;
        }}

        .time-diff-same {{
            color: #6c757d;
            font-weight: 600;
            background: #e9ecef;
            padding: 4px 8px;
            border-radius: 4px;
            display: inline-block;
        }}

        .time-diff-na {{
            color: #6c757d;
            font-style: italic;
        }}
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>🧪 Test Execution Report</h1>
            <div class="meta">
                <div>CRON Run ID: {cron_run_id} | Version: {repo_version} | Environment: {run_env}{comparison_info}</div>
                <div>{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}</div>
            </div>
        </div>

        <div class="summary">
            <div class="summary-card">
                <div class="label">Modules</div>
                <div class="value">{len(modules)}</div>
            </div>
            <div class="summary-card">
                <div class="label">Total Tests</div>
                <div class="value">{total_tests}</div>
            </div>
            <div class="summary-card passed">
                <div class="label">Passed</div>
                <div class="value">{total_passed}</div>
            </div>
            <div class="summary-card failed">
                <div class="label">Failed</div>
                <div class="value">{total_failed}</div>
            </div>
            <div class="summary-card skipped">
                <div class="label">Skipped</div>
                <div class="value">{total_skipped}</div>
            </div>
            <div class="summary-card">
                <div class="label">Pass Rate</div>
                <div class="value">{pass_rate}%</div>
            </div>
        </div>

        <div class="modules">
            <h2> Test Modules</h2>
'''

        # Add module cards
        for module in modules:
            module_name = module['module_name']
            tests_run = module.get('test_cases_run', 0)
            tests_passed = module.get('test_cases_passed', 0)
            tests_failed = module.get('test_cases_failed', 0)
            tests_skipped = module.get('test_cases_skipped', 0)
            slack_link = module.get('slack_report_link', '')

            # Determine status icon
            if tests_failed == 0 and tests_passed == tests_run:
                status_class = 'passed'
            elif tests_failed > 0:
                status_class = 'failed'
            else:
                status_class = 'partial'

            # Get previous data for comparison
            prev_module = prev_map.get(module_name)
            comparison_html = ''
            if prev_module:
                prev_passed = prev_module.get('test_cases_passed', 0)
                prev_failed = prev_module.get('test_cases_failed', 0)
                prev_skipped = prev_module.get('test_cases_skipped', 0)

                passed_diff = tests_passed - prev_passed
                failed_diff = tests_failed - prev_failed
                skipped_diff = tests_skipped - prev_skipped

                passed_class = 'better' if passed_diff > 0 else ('worse' if passed_diff < 0 else 'same')
                failed_class = 'better' if failed_diff < 0 else ('worse' if failed_diff > 0 else 'same')

                comparison_html = f'''
                <div class="comparison">
                    <div class="comparison-title"> Comparison with Previous Run</div>
                    <div class="comparison-stats">
                        <div class="comparison-item">
                            <span>Passed:</span>
                            <span class="comparison-change {passed_class}">{prev_passed} → {tests_passed} ({passed_diff:+d})</span>
                        </div>
                        <div class="comparison-item">
                            <span>Failed:</span>
                            <span class="comparison-change {failed_class}">{prev_failed} → {tests_failed} ({failed_diff:+d})</span>
                        </div>
                        <div class="comparison-item">
                            <span>Skipped:</span>
                            <span class="comparison-change same">{prev_skipped} → {tests_skipped} ({skipped_diff:+d})</span>
                        </div>
                    </div>
                </div>
                '''

            module_id = module_name.replace('-', '_').replace(' ', '_')

            html += f'''
            <div class="module-card" onclick="toggleModule('{module_id}')">
                <div class="module-header" id="header_{module_id}">
                    <div class="module-name">
                        <span class="status-icon {status_class}"></span>
                        <span>{module_name.replace('-', ' ').replace('_', ' ').title()}</span>
                        <span class="chevron" id="chevron_{module_id}">▼</span>
                    </div>
                    <div class="module-stats">
                        <div class="stat">
                            <span class="stat-label">Total</span>
                            <span class="stat-value">{tests_run}</span>
                        </div>
                        <div class="stat passed">
                            <span class="stat-label">Passed</span>
                            <span class="stat-value">{tests_passed}</span>
                        </div>
                        <div class="stat failed">
                            <span class="stat-label">Failed</span>
                            <span class="stat-value">{tests_failed}</span>
                        </div>
                        <div class="stat skipped">
                            <span class="stat-label">Skipped</span>
                            <span class="stat-value">{tests_skipped}</span>
                        </div>
                    </div>
                </div>
                <div class="module-details" id="details_{module_id}">
                    {comparison_html}
                    <div class="test-list">
                        <h3 style="margin-bottom: 15px; color: #495057;">Test Cases</h3>
                        {self.generate_test_list_html(module, prev_module)}
                    </div>
                    {f'<a href="{slack_link}" target="_blank" class="slack-link"> View in Slack</a>' if slack_link else ''}
                </div>
            </div>
            '''

        html += '''
        </div>

        <div class="footer">
            <div>Generated by Xyne Test Automation Framework</div>
            <div style="margin-top: 5px; opacity: 0.7;">Interactive HTML Report with Version Comparison</div>
        </div>
    </div>

    <script>
        function toggleModule(moduleId) {
            const details = document.getElementById('details_' + moduleId);
            const header = document.getElementById('header_' + moduleId);
            const chevron = document.getElementById('chevron_' + moduleId);

            details.classList.toggle('active');
            header.classList.toggle('expanded');
            chevron.classList.toggle('rotated');
        }

        // Auto-expand first module
        window.addEventListener('load', function() {
            const firstModule = document.querySelector('.module-card');
            if (firstModule) {
                firstModule.click();
            }
        });
    </script>
</body>
</html>
'''

        return html

def main():
    """Main function to generate HTML report."""
    try:
        cron_run_id = None

        if len(sys.argv) > 1:
            cron_run_id = sys.argv[1]
        else:
            cron_run_id = os.getenv('CRON_RUN_ID')

        if not cron_run_id:
            print(' Error: CRON_RUN_ID not provided. Use as argument or environment variable.')
            sys.exit(1)

        generator = InteractiveHtmlReportGenerator()
        output_path = generator.generate_html_report(cron_run_id)

        if output_path:
            print(f' HTML report generated successfully: {output_path}')

            # Upload to Slack
            try:
                slack_notifier = SlackNotifier()

                # Find the PDF message timestamp to create a thread
                pdf_message_ts = slack_notifier.find_pdf_message_ts(cron_run_id)

                # Upload HTML to Slack (as thread if PDF message found)
                slack_url = slack_notifier.upload_html_to_slack_thread(
                    output_path,
                    cron_run_id,
                    thread_ts=pdf_message_ts
                )

                if slack_url:
                    print(' HTML report uploaded to Slack successfully')
                else:
                    print('️ Failed to upload HTML report to Slack, but generation was successful')

            except Exception as slack_error:
                print(f'️ Error uploading HTML to Slack: {slack_error}')
                print(' HTML generation was successful, continuing...')

            print(f'HTML_OUTPUT_PATH:{output_path}')
            sys.exit(0)
        else:
            sys.exit(1)

    except Exception as e:
        print(f' Error in main: {e}')
        import traceback
        traceback.print_exc()
        sys.exit(1)

if __name__ == '__main__':
    main()
