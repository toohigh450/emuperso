"""Run each JS suite in its own process, retain assertion-level TAP, then Python.
Node 24 required. No ROM, BIOS, runtime download, or user database is accessed.
"""
import argparse, json, re, subprocess, sys
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', type=Path, default=ROOT/'cache'/'test-results')
    args = parser.parse_args(); args.output.mkdir(parents=True, exist_ok=True)
    results = []
    for suite in sorted((ROOT/'tests').glob('*.test.mjs')):
        command = ['node','--test','--test-isolation=none','--test-reporter=tap',str(suite)]
        done = subprocess.run(command, cwd=ROOT, capture_output=True, text=True, encoding='utf-8', errors='replace')
        (args.output/(suite.stem+'.tap')).write_text(done.stdout+done.stderr, encoding='utf-8')
        counts = {}
        for key in ['tests','pass','fail']:
            matches = re.findall(r'^# '+key+r' (\d+)',done.stdout,re.M)
            counts[key] = int(matches[-1]) if matches else None
        row = {'suite':suite.name,'exit_code':done.returncode,**counts}
        results.append(row); print(json.dumps(row),flush=True)
    done = subprocess.run([sys.executable,'-m','unittest','discover','-s','tests','-p','test_*.py','-v'],
                          cwd=ROOT,capture_output=True,text=True,encoding='utf-8',errors='replace')
    (args.output/'python.txt').write_text(done.stdout+done.stderr,encoding='utf-8')
    summary = {'node':results,'node_tests':sum(row['tests'] or 0 for row in results),
               'python_exit_code':done.returncode,'all_passed':all(row['exit_code']==0 and row['tests'] for row in results) and done.returncode==0}
    (args.output/'summary.json').write_text(json.dumps(summary,indent=2),encoding='utf-8')
    print(json.dumps(summary,indent=2)); return 0 if summary['all_passed'] else 1
if __name__=='__main__':sys.exit(main())
