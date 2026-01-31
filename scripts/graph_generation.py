
import os
import lzma
import boto3
import argparse
import subprocess
import networkx as nx
from pathlib import Path
from importlib.resources import files

# AWS S3 Configuration
REPO_NAME = "xyne-spaces_backend"
BUCKET_NAME = os.getenv('BUCKET_NAME', "euler-jenkins-assets")
LOCAL_BUCKET_NAME = os.getenv("BUCKET_NAME", "bitbot-test")
LOCAL_AWS_REGION = os.getenv("AWS_REGION", "us-east-1")
LOCAL_AWS_ENDPOINT = os.getenv("AWS_ENDPOINT_URL", "http://127.0.0.1:4566")
LOCAL_AWS_PROFILE = os.getenv("AWS_PROFILE", "localstack")
LOCAL_TESTING = os.getenv("LOCAL_TESTING", False)

CUR_PATH = os.path.abspath(__file__)

def check_node() -> bool:
    try:
        result = subprocess.run(['node', '--version'], capture_output=True, text=True, check=True)
        if result.stdout:
            return True
        return False
    except:
        print("Unable to check node version. Please ensure node is installed and set in path")
        return False

def create_ts_fdep(js_path: str, tsconfig_path: str, output_dir: str) -> tuple[bool, Path | None]:
    try:
        result = subprocess.run(["node", js_path, tsconfig_path, "-o", str(output_dir)], capture_output=True, text=True, check=True)
        if result.stdout:
            return (True, output_dir / "fdep-output.json")
        return (False, None)
    except Exception as e:
        print(e)
        return (False, None)
    
def process_ts_output(output_pth: Path, pickle_file_path: Path):
    if not output_pth.exists():
        print(output_pth, "doesn't exist")
        exit(1)

    import json
    from typing import Dict, Any

    if output_pth.exists():
        content = output_pth.read_text()
        ts_fdep: Dict[Any, Any] = json.loads(content)
        graph = nx.DiGraph()
        nodes_dct = ts_fdep.get("nodes", {})
        for node in nodes_dct:
            node_dct = nodes_dct[node]
            graph.add_node(
                node,
                file=node_dct.get("file", "<NO-FILE-PATH>"),
                name=node_dct.get("label", "<NO-LABEL>"),
                code=node_dct.get("code", "<NO-CODE>"),
                node_type=node_dct.get("nodeType", "<NO-TYPE>").lower()
            )
        for (src, dst) in ts_fdep.get("edges", []):
            if src != dst:
                graph.add_edge(src, dst)
        import pickle
        with open(pickle_file_path, "wb") as f:
            pickle.dump(graph, f)
        print(f"Graph successfully stored in the {pickle_file_path}")

def get_git_commit_hash() -> str:
    try:
        return ( 
            subprocess.check_output(["git", "rev-parse", "HEAD"])
            .decode("ascii")
            .strip()
        )
    except subprocess.CalledProcessError:
        print("Warning: Unable to get Git commit hash. Using 'latest' instead.")
        return "latest"

def compress_pickle_file(pickle_file_path):
        """Compress pickle file with maximum lzma compression"""
        compressed_file_path = f"{pickle_file_path}.xz"

        try:
            print(f"Compressing pickle file {pickle_file_path}...")
            original_size = os.path.getsize(pickle_file_path)

            with open(pickle_file_path, "rb") as input_file:
                with lzma.open(compressed_file_path, "wb", preset=9) as compressed_file:
                    compressed_file.write(input_file.read())

            compressed_size = os.path.getsize(compressed_file_path)
            compression_ratio = (1 - compressed_size / original_size) * 100

            print(f"Compression complete!")
            print(f"Original size: {original_size:,} bytes")
            print(f"Compressed size: {compressed_size:,} bytes")
            print(f"Compression ratio: {compression_ratio:.1f}%")

            # Remove original file to save space
            os.remove(pickle_file_path)

            return compressed_file_path
        except Exception as e:
            print(f"Error compressing file: {e}")
            return pickle_file_path
        
def upload_file_to_s3(file_path, commit_hash, normalBranch):
        try:
            compressed_file_path = compress_pickle_file(file_path)

            if not LOCAL_TESTING:
                s3_client = boto3.client('s3')
                bucket_name = BUCKET_NAME
            else:
                s3_client = boto3.client('s3', region_name=LOCAL_AWS_REGION, endpoint_url=LOCAL_AWS_ENDPOINT, aws_secret_access_key='test', aws_access_key_id='test')
                bucket_name = LOCAL_BUCKET_NAME
            
            # Update S3 key to reflect compressed format
            file_extension = ".pkl.xz"
            s3_key = f"manifest/{REPO_NAME}/graph/{commit_hash}{file_extension}"
            s3_client.upload_file(compressed_file_path, bucket_name, s3_key)
            print(f"Uploaded FDEP archive to s3://{bucket_name}/{s3_key}")

            if not normalBranch: 
                s3_key = f"TYPESCRIPT/CODE_GRAPHS_DO_NOT_TOUCH/{REPO_NAME}{file_extension}"
                s3_client.upload_file(compressed_file_path, bucket_name, s3_key)
                print(f"Uploaded FDEP archive to s3://{bucket_name}/{s3_key}")
        except Exception as e:
            print(f"FDEP archive upload error: {e}")

def main(codepath, fromBranch):

    pth = Path(codepath + "/backend")
    commitHash = get_git_commit_hash()
    output_dir = Path("./")

    pickle_file_path = output_dir / f"{REPO_NAME}_graph.pkl"
    tsconfig_path = None
    for pth in pth.iterdir():
        if pth.name == "tsconfig.json":
            tsconfig_path = pth
    if tsconfig_path is None:
        print("No tsconfig file found in ", str(pth))

    print(tsconfig_path)
    if check_node():
        js_path = files("ts_fdep") / "fdep.js"
        print(js_path)
        result, output_pth = create_ts_fdep(str(js_path), tsconfig_path, output_dir)
        if result:
            print("TS FDEP data successfully generated")
            process_ts_output(output_pth, pickle_file_path)
        else:
            print("Unable to create TS FDEP data")
            exit(1)
    
    upload_file_to_s3(file_path=pickle_file_path, commit_hash=commitHash, normalBranch=False) # this script will run only for main branch

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Generate test cases from a Git repository.")
    parser.add_argument("--codepath", required=True, help="The root directory of the code repository.")
    parser.add_argument("--fromBranch", required=True, help="The source branch for the comparison.")
    
    args = parser.parse_args()
    main(args.codepath, args.fromBranch)