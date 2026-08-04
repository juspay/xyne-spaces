import subprocess
import csv
import sys

# GitHub commit base URL. Commit messages may contain PR numbers from another
# repo/import, so deriving PR links from "(#123)" can open the wrong PR.
REPO_COMMIT_BASE_URL = "https://github.com/juspay/xyne-spaces/commit"


def generate_commit_link(commit_id):
    """Generate a stable commit link URL."""
    if not commit_id:
        return ""
    return f"{REPO_COMMIT_BASE_URL}/{commit_id}"


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
            writer.writerow(["Commit ID", "Author", "Date", "Message", "Commit Link"])

            for commit in commits:
                parts = commit.split(",", 3)
                if len(parts) == 4:
                    commit_id, author, date, message = parts
                    commit_link = generate_commit_link(commit_id)
                    writer.writerow([commit_id, author, date, message, commit_link])

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
