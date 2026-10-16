import importlib.util
import sys
import tempfile
import unittest
from pathlib import Path
import website_observation_support as support

ROOT=Path(__file__).resolve().parent


class WebsiteObservation(unittest.TestCase):
    def test_saved_reports_survive_unchanged_checks(self):
        state={'archive_reports':[{'file':'HTML','analysis':{'added_urls':['https://example.org/wallet.zip']}}]}
        for _ in range(3):state={'archive_reports':support.retained_archive_reports(state)}
        self.assertEqual(state['archive_reports'][0]['analysis']['added_urls'],['https://example.org/wallet.zip'])

    def test_reports_are_bounded_and_malformed_values_ignored(self):
        self.assertEqual(support.retained_archive_reports({'archive_reports':{}}),[])
        rows=support.retained_archive_reports({'archive_reports':[None]+[{'number':i} for i in range(25)]})
        self.assertEqual(len(rows),20)
        self.assertEqual(rows[0]['number'],5)

    def test_renamed_bundle_pairs_with_last_deployment(self):
        oldkey='JS: https://example.org/old.js';newkey='JS: https://example.org/new.js'
        old={'fingerprints':{oldkey:'before'}}
        archive={oldkey:{'path':'previous'},newkey:{'path':'stale-historical-file'}}
        self.assertEqual(support.previous_archive_for(newkey,'JS',{newkey:None},old,archive),{'path':'previous'})

    def test_multiple_bundles_are_not_assumed_to_match(self):
        old={'fingerprints':{'JS: old1':'a','JS: old2':'b'}}
        self.assertIsNone(support.previous_archive_for('JS: new','JS',{'JS: new':None},old,{'JS: old1':{'path':'x'}}))

    def test_html_and_existing_asset_use_direct_archive(self):
        reference={'path':'previous'}
        self.assertEqual(support.previous_archive_for('HTML','HTML',{'HTML':None},{'fingerprints':{'HTML':'a'}},{'HTML':reference}),reference)

    def test_installer_and_pipeline_keep_actual_analysis_after_no_change(self):
        spec=importlib.util.spec_from_file_location('website_installer',ROOT/'install-website-observation.py')
        installer=importlib.util.module_from_spec(spec);spec.loader.exec_module(installer)
        source='''
def check_website():
    old = load_state()
    now = "test-time"
    downloaded = downloads
    archive_index = old.get("archive_index", {})
    archive_reports = []
    for key, (kind, source_url, content) in downloaded.items():
        current = archive_version(kind, source_url, content)
        previous_archive = archive_index.get(key)
        if previous_archive and previous_archive["sha256"] != current["sha256"]:
            archive_reports.append({
                "file": key,
                "old_sha256": previous_archive["sha256"],
                "new_sha256": current["sha256"],
                "diff_path": "diff",
                "analysis": {"added_urls": ["https://example.org/new-wallet.zip"]},
            })
        archive_index[key] = current
    state = {"archive_reports": archive_reports[-20:], "archive_index": archive_index, "fingerprints": {k:v[2] for k,v in downloaded.items()}}
    save_state(state)
    return state
def status_text():
    lines=[]
    lines.append("No code analysis available yet.")
    return lines
'''
        with tempfile.TemporaryDirectory(dir=ROOT) as folder:
            target=Path(folder)
            (target/'website_watch.py').write_text(source,encoding='utf-8')
            backup=installer.install(target,ROOT,apply=True)
            self.assertEqual((backup/'website_watch.py').read_text(encoding='utf-8'),source)
            namespace={'load_state':lambda:state,'save_state':lambda value:state.update(value),'downloads':{'JS: new':('JS','https://example.org/new.js','new')},'archive_version':lambda kind,url,content:{'path':'new','sha256':content}}
            state={'fingerprints':{'JS: old':'old'},'archive_index':{'JS: old':{'path':'old','sha256':'old'}}}
            exec(compile((target/'website_watch.py').read_text(encoding='utf-8'),'website_watch.py','exec'),namespace)
            namespace['check_website']()
            namespace['check_website']()
            self.assertEqual(len(state['archive_reports']),1)
            self.assertIn('https://example.org/new-wallet.zip',state['archive_reports'][0]['analysis']['added_urls'])
            self.assertEqual(state['archive_reports'][0]['time'],'test-time')
            self.assertIsNone(installer.install(target,ROOT,apply=True))

    def test_unknown_monitor_is_rejected(self):
        spec=importlib.util.spec_from_file_location('website_installer_unknown',ROOT/'install-website-observation.py')
        installer=importlib.util.module_from_spec(spec);spec.loader.exec_module(installer)
        with self.assertRaises(ValueError):installer.patch('x=1\n')


if __name__=='__main__':unittest.main()
