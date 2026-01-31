#!/usr/bin/env python3
"""
PDF Report Generator for Test Execution Results
Generates professional PDF reports from PostgreSQL database records using ReportLab
"""

import os
import sys
import json
import requests
from datetime import datetime
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer
from reportlab.lib import colors
from reportlab.lib.colors import Color

# Load environment variables from .env file
def load_env_file():
    """Load environment variables from .env file."""
    # Get the project root directory (3 levels up from this file)
    current_dir = os.path.dirname(os.path.abspath(__file__))  # utils directory
    framework_dir = os.path.dirname(current_dir)  # framework directory
    src_dir = os.path.dirname(framework_dir)  # src directory
    project_root = os.path.dirname(src_dir)  # project root directory
    env_path = os.path.join(project_root, '.env')
    
    print(f" Looking for .env file at: {env_path}")
    
    if os.path.exists(env_path):
        with open(env_path, 'r') as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith('#') and '=' in line:
                    key, value = line.split('=', 1)
                    # Remove quotes if present
                    value = value.strip('\'"')
                    os.environ[key] = value
        print(f" Loaded environment variables from {env_path}")
    else:
        print(f" .env file not found at {env_path}")

# Load environment variables at module level
load_env_file()

class SlackNotifier:
    """Simple Slack notifier for PDF reports."""
    
    def __init__(self):
        """Initialize Slack notifier."""
        self.bot_token = os.environ.get('SLACK_BOT_TOKEN')
        self.channel_id = os.environ.get('SLACK_CHANNEL_ID', 'xyne-automation')
        self.is_enabled = bool(self.bot_token)
        
        if not self.is_enabled:
            print(' Slack notifications disabled: SLACK_BOT_TOKEN not found in environment')
    
    def send_pdf_notification(self, pdf_path, cron_run_id, summary, environment):
        """Send PDF report to Slack."""
        if not self.is_enabled:
            print(' Slack notification skipped: Not configured')
            return False
        
        try:
            # Prepare the message
            current_time = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
            
            # Determine status emoji based on results
            status_emoji = '' if summary['total_failed'] > 0 else ('' if summary['total_skipped'] > 0 else '🟢')
            
            message_text = f"{status_emoji} *PDF Test Execution Report Generated*\n\n"
            message_text += f" **Summary for CRON Run ID: {cron_run_id}**\n"
            message_text += f"• Environment: {environment}\n"
            message_text += f"• Total Modules: {summary['total_modules']}\n"
            message_text += f"• Total Tests: {summary['total_tests']}\n"
            message_text += f"• Passed: {summary['total_passed']}\n"
            message_text += f"• Failed: {summary['total_failed']}\n"
            message_text += f"• Skipped: {summary['total_skipped']}\n"
            message_text += f"• Pass Rate: {summary['pass_rate']}%\n"
            message_text += f"• Generated: {current_time}\n\n"
            message_text += f" PDF report attached below."
            
            # Upload file to Slack
            return self.upload_file_to_slack(pdf_path, message_text)
            
        except Exception as e:
            print(f' Error sending Slack notification: {e}')
            return False
    
    def upload_file_to_slack(self, file_path, message):
        """Upload file to Slack using files.uploadV2 API (3-step workflow) and return the message timestamp."""
        try:
            headers = {'Authorization': f'Bearer {self.bot_token}'}
            file_size = os.path.getsize(file_path)
            file_name = os.path.basename(file_path)

            print(f' Uploading PDF report to Slack channel: {self.channel_id}')

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
            with open(file_path, 'rb') as file:
                upload_response = requests.post(
                    upload_url,
                    files={'file': (file_name, file, 'application/pdf')},
                    timeout=35
                )

                if not upload_response.ok:
                    print(f' Failed to upload file: HTTP {upload_response.status_code}')
                    return False

            # Step 3: Complete the upload
            complete_response = requests.post(
                'https://slack.com/api/files.completeUploadExternal',
                headers={**headers, 'Content-Type': 'application/json'},
                json={
                    'files': [{'id': file_id, 'title': f'Test Execution Report - {file_name}'}],
                    'channel_id': self.channel_id,
                    'initial_comment': message
                },
                timeout=30
            )

            if complete_response.ok:
                result = complete_response.json()
                if result.get('ok'):
                    print(' PDF report uploaded to Slack successfully')

                    files = result.get('files', [])
                    if files and files[0].get('permalink'):
                        print(f' Slack file URL: {files[0]["permalink"]}')

                    # Extract message timestamp
                    file_data = files[0] if files else {}
                    shares = file_data.get('shares', {})

                    # Try to extract timestamp from shares
                    if shares and 'public' in shares:
                        for channel_id, share_data in shares['public'].items():
                            if isinstance(share_data, list) and len(share_data) > 0:
                                ts = share_data[0].get('ts')
                                if ts:
                                    print(f' Message timestamp: {ts}')
                                    return ts

                    # Fallback: Try to get from channel history
                    print(' Timestamp not in response, fetching from channel history...')
                    try:
                        import time
                        time.sleep(1)  # Brief delay to ensure message is in history

                        history_response = requests.get(
                            'https://slack.com/api/conversations.history',
                            headers={'Authorization': f'Bearer {self.bot_token}'},
                            params={'channel': self.channel_id, 'limit': 1},
                            timeout=10
                        )

                        if history_response.ok:
                            history_data = history_response.json()
                            if history_data.get('ok') and history_data.get('messages'):
                                latest_message = history_data['messages'][0]
                                ts = latest_message.get('ts')
                                if ts:
                                    print(f' Message timestamp from history: {ts}')
                                    return ts
                    except Exception as e:
                        print(f' Could not fetch from history: {e}')

                    # Final fallback
                    print(' Could not extract message timestamp')
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

class TestExecutionPdfGenerator:
    def __init__(self):
        """Initialize the PDF generator."""
        self.auth_token = None
        
    def authenticate_with_juspay(self):
        """Get authentication token using Juspay API."""
        try:
            login_url = 'https://roaming.sandbox.portal.juspay.in/api/ec/v1/admin/login'
            
            username = os.environ.get('JUSPAY_USERNAME')
            password = os.environ.get('JUSPAY_PASSWORD')
            # username='john.doe@gmail.com'
            # password='REDACTED'
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
    
    def fetch_report_data(self, cron_run_id):
        """Fetch test execution data from xyne_test_module table with version info."""
        try:
            if not self.auth_token:
                self.authenticate_with_juspay()

            # Fetch from xyne_test_module table with run metadata and version info
            query = f"""
                SELECT
                    m.module_name,
                    m.run_data,
                    m.slack_report_link,
                    r.run_by as username,
                    r.run_env as runenv,
                    r.cron_run_id,
                    r.created_at as run_datetime,
                    r.repo_version,
                    r.previous_version,
                    r.previous_run_id
                FROM xyne_test_module m
                JOIN xyne_test_runs r ON m.cron_run_id = r.cron_run_id
                WHERE m.cron_run_id = '{cron_run_id}'
                ORDER BY m.module_name
            """

            print(f' Fetching data for CRON_RUN_ID: {cron_run_id} from xyne_test_module')

            # Execute query
            db_endpoint = os.getenv('DB_API_ENDPOINT', 'https://sandbox.portal.juspay.in/dashboard-test-automation/dbQuery')

            response = requests.get(
                db_endpoint,
                headers={
                    'x-web-logintoken': self.auth_token,
                    'Content-Type': 'application/json'
                },
                json={'query': query},
                timeout=30
            )

            print(f' Database response status: {response.status_code}')

            if not response.ok:
                raise Exception(f'Database query failed: {response.status_code} {response.text}')

            result = response.json()

            # Check for data in 'response' field
            if result.get('response') and len(result['response']) > 0:
                raw_records = result['response']
                print(f' Found {len(raw_records)} module records')

                # Transform data from JSONB format to legacy format for PDF generation
                records = []
                for record in raw_records:
                    run_data = record.get('run_data', {})
                    tests = run_data.get('tests', [])

                    # Calculate statistics from test data
                    total_tests = len(tests)
                    passed = len([t for t in tests if t.get('status') == 'passed'])
                    failed = len([t for t in tests if t.get('status') == 'failed'])
                    skipped = len([t for t in tests if t.get('status') == 'skipped'])

                    # Count priority failures
                    highest_failed = len([t for t in tests if t.get('status') == 'failed' and t.get('priority') == 'highest'])
                    high_failed = len([t for t in tests if t.get('status') == 'failed' and t.get('priority') == 'high'])
                    medium_failed = len([t for t in tests if t.get('status') == 'failed' and t.get('priority') == 'medium'])
                    low_failed = len([t for t in tests if t.get('status') == 'failed' and t.get('priority') == 'low'])

                    # Create legacy-compatible record
                    transformed_record = {
                        'module_name': record.get('module_name'),
                        'test_cases_run': total_tests,
                        'test_cases_passed': passed,
                        'test_cases_failed': failed,
                        'test_cases_skipped': skipped,
                        'highest_priority_failed': highest_failed,
                        'high_priority_failed': high_failed,
                        'medium_priority_failed': medium_failed,
                        'low_priority_failed': low_failed,
                        'slack_report_link': record.get('slack_report_link'),
                        'username': record.get('username'),
                        'runenv': record.get('runenv'),
                        'cron_run_id': record.get('cron_run_id'),
                        'run_datetime': record.get('run_datetime'),
                        'repo_version': record.get('repo_version', 'N/A'),
                        'previous_version': record.get('previous_version'),
                        'previous_run_id': record.get('previous_run_id')
                    }
                    records.append(transformed_record)

                print(f' Transformed {len(records)} records for PDF generation')
                return records

            # No data found
            else:
                print('📭 No records found for the specified CRON_RUN_ID')
                print(f' Result structure: {result}')
                return None

        except Exception as e:
            print(f' Error fetching report data: {e}')
            import traceback
            traceback.print_exc()
            return None
    
    def calculate_summary(self, records):
        """Calculate summary statistics from records."""
        total_modules = len(records)
        total_tests = sum(record.get('test_cases_run', 0) for record in records)
        total_passed = sum(record.get('test_cases_passed', 0) for record in records)
        total_failed = sum(record.get('test_cases_failed', 0) for record in records)
        total_skipped = sum(record.get('test_cases_skipped', 0) for record in records)
        pass_rate = round((total_passed / total_tests) * 100) if total_tests > 0 else 0
        
        return {
            'total_modules': total_modules,
            'total_tests': total_tests,
            'total_passed': total_passed,
            'total_failed': total_failed,
            'total_skipped': total_skipped,
            'pass_rate': pass_rate
        }
    
    def generate_pdf_report(self, cron_run_id, output_path=None):
        """Generate PDF report for a specific CRON_RUN_ID. Returns (output_path, records, summary, environment)."""
        try:
            print(f' Generating PDF report for CRON_RUN_ID: {cron_run_id}')

            # Fetch data from database
            records = self.fetch_report_data(cron_run_id)
            if not records:
                print(' No data found for the specified CRON_RUN_ID')
                return None, None, None, None

            # Calculate summary
            summary = self.calculate_summary(records)

            # Get environment, date, and version info from first record
            environment = records[0].get('runenv', 'Unknown')
            report_date = records[0].get('run_datetime', datetime.now().isoformat())
            repo_version = records[0].get('repo_version', 'N/A')
            previous_version = records[0].get('previous_version')
            previous_run_id = records[0].get('previous_run_id')

            # Generate output path if not provided
            if not output_path:
                timestamp = datetime.now().strftime('%Y-%m-%d_%H-%M-%S')
                output_path = f'reports/test-execution-report-{cron_run_id}-{timestamp}.pdf'

            # Ensure reports directory exists
            os.makedirs(os.path.dirname(output_path), exist_ok=True)

            # Create PDF with version info
            self.create_pdf(output_path, cron_run_id, environment, report_date, records, summary,
                          repo_version, previous_version, previous_run_id)

            print(f' PDF report generated successfully: {output_path}')
            return output_path, records, summary, environment

        except Exception as e:
            print(f' Error generating PDF report: {e}')
            return None, None, None, None
    
    def create_pdf(self, output_path, cron_run_id, environment, report_date, records, summary,
                   repo_version='N/A', previous_version=None, previous_run_id=None):
        """Create the actual PDF document with version comparison info."""
        try:
            # Create PDF document
            pdf = SimpleDocTemplate(
                output_path,
                pagesize=A4,
                leftMargin=20,
                rightMargin=20,
                topMargin=30,
                bottomMargin=20
            )

            elements = []

            # Header
            main_header = Paragraph("Test Execution Report", ParagraphStyle(
                name="MainHeader",
                fontSize=24,
                alignment=TA_CENTER,
                fontName="Helvetica-Bold",
                textColor=colors.darkblue,
            ))

            # Format date
            try:
                date_obj = datetime.fromisoformat(report_date.replace('Z', '+00:00'))
                formatted_date = date_obj.strftime('%Y-%m-%d')
            except:
                formatted_date = datetime.now().strftime('%Y-%m-%d')

            # Build header text with version info
            header_text = f" Date: {formatted_date} | Environment: {environment} | Run ID: {cron_run_id} | Version: {repo_version}"
            if previous_version and previous_run_id:
                header_text += f"<br/>Comparing with: {previous_version} (Run: {previous_run_id})"

            secondary_header = Paragraph(
                header_text,
                ParagraphStyle(
                    name="SecondaryHeader",
                    fontSize=11,
                    alignment=TA_CENTER,
                    fontName="Helvetica",
                    textColor=colors.darkblue,
                )
            )
            
            
            elements.extend([main_header, Spacer(1, 20), secondary_header, Spacer(1, 5)])
            
            # Summary section
            summary_header = Paragraph(" Execution Summary", ParagraphStyle(
                name="SummaryHeader",
                fontSize=16,
                alignment=TA_LEFT,
                fontName="Helvetica-Bold",
                textColor=colors.darkblue,
                spaceBefore=10,
                spaceAfter=10,
            ))
            elements.append(summary_header)
            
            # Summary table
            summary_data = [
                ['Modules', 'Total Tests', 'Passed', 'Failed', 'Skipped', 'Pass Rate'],
                [
                    str(summary['total_modules']),
                    str(summary['total_tests']),
                    str(summary['total_passed']),
                    str(summary['total_failed']),
                    str(summary['total_skipped']),
                    f"{summary['pass_rate']}%"
                ]
            ]
            
            summary_table = Table(summary_data, colWidths=[80, 80, 80, 80, 80, 80])
            summary_table.setStyle(TableStyle([
                ('BACKGROUND', (0, 0), (-1, 0), colors.darkblue),
                ('TEXTCOLOR', (0, 0), (-1, 0), colors.whitesmoke),
                ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
                ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
                ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
                ('GRID', (0, 0), (-1, -1), 0.5, colors.black),
                ('BACKGROUND', (0, 1), (-1, 1), colors.lightgrey),
                ('FONTNAME', (0, 1), (-1, 1), 'Helvetica'),
            ]))
            
            elements.append(summary_table)
            elements.append(Spacer(1, 20))
            
            # Main data table
            table_header = Paragraph(" Module Details", ParagraphStyle(
                name="TableHeader",
                fontSize=16,
                alignment=TA_LEFT,
                fontName="Helvetica-Bold",
                textColor=colors.darkblue,
                spaceBefore=10,
                spaceAfter=10,
            ))
            elements.append(table_header)
            
            # Table headers - matching the sample format
            headers = ['Module', 'Total Run', 'Passed', 'Failed', '', '', '', 'Skipped', 'Report']
            
            # Create a second header row for the Failed breakdown
            sub_headers = ['', '', '', 'HHP', 'HP', 'MP', 'LP', '', '']
            
            # Prepare table data with two header rows
            table_data = [headers, sub_headers]
            
            # Define colors
            lightorange = Color(1, 0.8, 0.6)  # Light orange
            lightred = Color(1, 0.7, 0.7)  # Light red
            light_red = Color(1, 0.5, 0.5)
            lightgreen = Color(0.565, 0.933, 0.565)

            very_light_blue = Color(0.9, 0.95, 1)
            muted_orange = Color(1, 0.7, 0.5)  # Less bright orange
            muted_yellow = Color(1, 1, 0.6)  # Less bright yellow
            
            cell_style = ParagraphStyle(
                name="CellStyle",
                fontSize=10,
                alignment=TA_CENTER,
                spaceBefore=2,
                spaceAfter=2,
            )
            
            for record in records:
                module_name = record.get('module_name', '')
                test_cases_run = record.get('test_cases_run', 0)
                test_cases_passed = record.get('test_cases_passed', 0)
                test_cases_skipped = record.get('test_cases_skipped', 0)
                test_cases_failed = record.get('test_cases_failed', 0)
                highest_priority_failed = record.get('highest_priority_failed', 0)
                high_priority_failed = record.get('high_priority_failed', 0)
                medium_priority_failed = record.get('medium_priority_failed', 0)
                low_priority_failed = record.get('low_priority_failed', 0)
                slack_report_link = record.get('slack_report_link')
                
                # Format module name (left aligned for module column)
                module_style = ParagraphStyle(
                    name="ModuleStyle",
                    fontSize=10,
                    alignment=TA_LEFT,
                    spaceBefore=2,
                    spaceAfter=2,
                )
                formatted_module = Paragraph(module_name.replace('-', ' ').replace('_', ' ').title(), module_style)
                
                # Format Slack link
                if slack_report_link:
                    link_style = ParagraphStyle(
                        name="LinkStyle",
                        fontSize=10,
                        textColor=colors.blue,
                        alignment=TA_CENTER,
                    )
                    slack_link = Paragraph(f'<a href="{slack_report_link}" color="blue">Link</a>', link_style)
                else:
                    slack_link = Paragraph('-', cell_style)
                
                table_data.append([
                    formatted_module,
                    str(test_cases_run),
                    str(test_cases_passed),
                    str(highest_priority_failed),
                    str(high_priority_failed),
                    str(medium_priority_failed),
                    str(low_priority_failed),
                    str(test_cases_skipped),
                    slack_link
                ])
            
            # Create table with updated column widths for new format (9 columns)
            col_widths = [100, 70, 50, 40, 40, 40, 40, 50, 70]
            data_table = Table(table_data, colWidths=col_widths)
            
            # Apply table styling
            style = TableStyle([
                # Header row styling (first row)
                ('BACKGROUND', (0, 0), (-1, 0), colors.darkblue),
                ('TEXTCOLOR', (0, 0), (-1, 0), colors.whitesmoke),
                ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
                ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
                ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
                ('GRID', (0, 0), (-1, -1), 0.5, colors.black),
                
                # Sub-header row styling (second row)
                ('BACKGROUND', (0, 1), (-1, 1), colors.darkblue),
                ('TEXTCOLOR', (0, 1), (-1, 1), colors.whitesmoke),
                ('FONTNAME', (0, 1), (-1, 1), 'Helvetica-Bold'),
                
                # Data rows styling
                ('FONTNAME', (0, 2), (-1, -1), 'Helvetica'),
                ('ALIGN', (0, 2), (0, -1), 'LEFT'),  # Left align module names
                
                # Merge cells for "Failed" header to span across HHP, HP, MP, LP columns
                ('SPAN', (3, 0), (6, 0)),  # Merge "Failed" across 4 columns (adjusted for 9-column layout)
            ])
            
            # Apply conditional coloring for data rows (starting from row 2 since we have 2 header rows)
            for i, record in enumerate(records, start=2):
                test_cases_passed = record.get('test_cases_passed', 0)
                test_cases_skipped = record.get('test_cases_skipped', 0)
                highest_priority_failed = record.get('highest_priority_failed', 0)
                high_priority_failed = record.get('high_priority_failed', 0)
                medium_priority_failed = record.get('medium_priority_failed', 0)
                low_priority_failed = record.get('low_priority_failed', 0)
                
                # Color the passed column (column 2)
                if int(highest_priority_failed) > 0:
                    style.add('BACKGROUND', (0, i), (0, i), light_red)  # Module Name column
                elif int(high_priority_failed) > 0:
                    style.add('BACKGROUND', (0, i), (0, i), lightred)
                elif int(medium_priority_failed) > 0:
                    style.add('BACKGROUND', (0, i), (0, i), muted_orange)
                elif int(low_priority_failed) > 0:
                    style.add('BACKGROUND', (0, i), (0, i), lightorange)
                else:
                    style.add('BACKGROUND', (0, i), (0, i), very_light_blue)
                
                style.add('BACKGROUND', (2, i), (2, i), lightgreen)
                
                style.add('BACKGROUND', (3, i), (3, i), light_red)
                style.add('BACKGROUND', (4, i), (4, i), lightred)
                style.add('BACKGROUND', (5, i), (5, i), muted_orange)
                style.add('BACKGROUND', (6, i), (6, i), lightorange)
                style.add('BACKGROUND', (7, i), (7, i), muted_yellow)
                # Apply background to remaining columns (Total Run and Report columns)
                for col in [1, 8]:  # Column 1 (Total Run) and Column 8 (Report)
                    style.add('BACKGROUND', (col, i), (col, i), very_light_blue)
            
            data_table.setStyle(style)
            elements.append(data_table)
            
            # Footer
            elements.append(Spacer(1, 30))
            footer = Paragraph(
                f"Generated by Xyne Test Automation Framework | CRON Run ID: {cron_run_id}<br/>Report generated on {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}",
                ParagraphStyle(
                    name="Footer",
                    fontSize=10,
                    alignment=TA_CENTER,
                    fontName="Helvetica",
                    textColor=colors.grey,
                )
            )
            elements.append(footer)
            
            # Build PDF
            pdf.build(elements)
            
        except Exception as e:
            print(f' Error creating PDF: {e}')
            raise

def main():
    """Main function to generate PDF report."""
    try:
        # Get CRON_RUN_ID from command line argument or environment variable
        cron_run_id = None
        
        if len(sys.argv) > 1:
            cron_run_id = sys.argv[1]
        else:
            cron_run_id = os.getenv('CRON_RUN_ID')
        
        if not cron_run_id:
            print(' Error: CRON_RUN_ID not provided. Use as argument or environment variable.')
            sys.exit(1)
        
        # Generate PDF report
        generator = TestExecutionPdfGenerator()
        output_path, records, summary, environment = generator.generate_pdf_report(cron_run_id)

        if output_path:
            print(f' PDF report generated successfully: {output_path}')

            # Send PDF to Slack
            try:
                print(' Sending PDF report to Slack...')

                # Use already-fetched data instead of fetching again
                if records and summary and environment:
                    # Initialize Slack notifier and send PDF
                    slack_notifier = SlackNotifier()
                    slack_success = slack_notifier.send_pdf_notification(
                        output_path, cron_run_id, summary, environment
                    )

                    if slack_success:
                        print(' PDF report sent to Slack successfully')

                        # Generate and upload HTML report as thread reply
                        try:
                            print('\n Generating HTML report for thread...')
                            import subprocess

                            # Get the path to the HTML report generator
                            current_dir = os.path.dirname(os.path.abspath(__file__))
                            html_generator_path = os.path.join(current_dir, 'html-report-generator.py')

                            # Execute HTML report generator
                            result = subprocess.run(
                                ['python3', html_generator_path, cron_run_id],
                                capture_output=True,
                                text=True,
                                timeout=120
                        )

                            if result.returncode == 0:
                                print(' HTML report generated and uploaded to Slack thread successfully')
                                # Extract HTML output path from stdout
                                for line in result.stdout.split('\n'):
                                    if line.startswith('HTML_OUTPUT_PATH:'):
                                        html_path = line.split(':', 1)[1]
                                        print(f' HTML Report: {html_path}')
                            else:
                                print(f' HTML report generation failed: {result.stderr}')

                        except Exception as html_error:
                            print(f' Error generating HTML report: {html_error}')
                            print(' PDF generation and upload was successful, continuing...')
                    else:
                        print(' Failed to send PDF report to Slack, but PDF generation was successful')
                else:
                    print(' Could not fetch data for Slack notification, but PDF generation was successful')

            except Exception as slack_error:
                print(f' Error sending PDF to Slack: {slack_error}')
                print(' PDF generation was successful, continuing...')

            # Output the path for the calling script
            print(f'PDF_OUTPUT_PATH:{output_path}')
            sys.exit(0)
        else:
            sys.exit(1)
            
    except Exception as e:
        print(f' Error in main: {e}')
        sys.exit(1)

if __name__ == '__main__':
    main()
