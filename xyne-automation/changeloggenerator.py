import subprocess
import csv
import sys
import re

# GitHub PR base URL
REPO_BASE_URL = "https://github.com/juspay/xyne-spaces-test/pull"


def extract_pr_number(message):
    """Extract GitHub PR number from commit messages."""
    match = re.search(r'\(#(\d+)\)', message)
    if match:
        return match.group(1)
    match = re.search(r'\b(?:PR|Pull request|Merge pull request)\s*#(\d+)', message, re.IGNORECASE)
    if match:
        return match.group(1)
    return None


def generate_pr_link(pr_number):
    """Generate PR link URL"""
    if not pr_number:
        return ""
    return f"{REPO_BASE_URL}/{pr_number}"


def generate_changelog(prev_commit, output_file="changelog.csv"):
    try:
        git_command = [
            "git", "log",
            f"{prev_commit}..HEAD",
            "--pretty=format:%h,%an,%ad,%s",
            "--date=short"
        ]

        result = subprocess.run(
            git_command,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            check=True
        )

        commits = result.stdout.strip().split("\n")

        if not commits or commits == ['']:
            print("No new commits found.")
            return

        with open(output_file, mode="w", newline="", encoding="utf-8") as file:
            writer = csv.writer(file)
            writer.writerow(["Commit ID", "Author", "Date", "Message", "PR Link"])

            for commit in commits:
                parts = commit.split(",", 3)
                if len(parts) == 4:
                    commit_id, author, date, message = parts
                    pr_number = extract_pr_number(message)
                    pr_link = generate_pr_link(pr_number)
                    writer.writerow([commit_id, author, date, message, pr_link])

        print(f":white_check_mark: Changelog generated successfully: {output_file}")

    except subprocess.CalledProcessError as e:
        print(":x: Error running git command:")
        print(e.stderr)
    except Exception as e:
        print(":x: Unexpected error:", str(e))


def get_previous_commit():
    if len(sys.argv) > 1:
        return sys.argv[1]

    # Prompt user if not passed as argument
    commit_id = input("Enter previous commit ID: ").strip()
    if not commit_id:
        print(":x: Commit ID cannot be empty.")
        sys.exit(1)

    return commit_id


if __name__ == "__main__":
    previous_commit_id = get_previous_commit()
    generate_changelog(previous_commit_id)
