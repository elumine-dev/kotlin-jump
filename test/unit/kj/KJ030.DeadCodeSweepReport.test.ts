import { describe, it, expect, beforeEach } from 'vitest';
import * as vscode from 'vscode';
import { DeadCodeSweepReport } from '../../../src/commands/DeadCodeSweep';
import { SweepFinding } from '../../../src/providers/DeadCodeSweep';

/** KJ-030 — publication dans Problems, sans doubler les warnings déjà vivants. */

const finding = (name: string): SweepFinding => ({
  detector: 'imports',
  line: 0,
  character: 0,
  name,
  message: `Import '${name}' is never used`,
  edits: [{ start: 0, end: 10, text: '' }],
});

const uriOf = (path: string) => vscode.Uri.file(path);
const published = (report: DeadCodeSweepReport) =>
  (report as unknown as { collection: { _entries: Map<string, unknown[]> } }).collection._entries;

describe('DeadCodeSweepReport', () => {
  beforeEach(() => {
    (vscode.workspace as unknown as { textDocuments: unknown[] }).textDocuments = [];
  });

  it('publie les trouvailles des fichiers fermés', () => {
    const report = new DeadCodeSweepReport();
    report.setScan({
      files: [{ uri: uriOf('/w/Closed.kt'), findings: [finding('com.x.A'), finding('com.x.B')] }],
      truncated: false,
    });
    expect(published(report).get('/w/Closed.kt')).toHaveLength(2);
    report.dispose();
  });

  it('n’en publie aucune pour un fichier ouvert : ses propres warnings vivants prennent le relais', () => {
    (vscode.workspace as unknown as { textDocuments: unknown[] }).textDocuments = [
      { uri: uriOf('/w/Open.kt') },
    ];
    const report = new DeadCodeSweepReport();
    report.setScan({
      files: [
        { uri: uriOf('/w/Open.kt'), findings: [finding('com.x.A')] },
        { uri: uriOf('/w/Closed.kt'), findings: [finding('com.x.B')] },
      ],
      truncated: false,
    });
    expect(published(report).has('/w/Open.kt')).toBe(false);
    expect(published(report).has('/w/Closed.kt')).toBe(true);
    report.dispose();
  });

  it('garde quand même les trouvailles du fichier ouvert en mémoire pour le résumé', () => {
    (vscode.workspace as unknown as { textDocuments: unknown[] }).textDocuments = [
      { uri: uriOf('/w/Open.kt') },
    ];
    const report = new DeadCodeSweepReport();
    report.setScan({ files: [{ uri: uriOf('/w/Open.kt'), findings: [finding('com.x.A')] }], truncated: false });
    expect(report.findingsFor('/w/Open.kt')).toHaveLength(1);
    report.dispose();
  });

  it('un nouveau scan remplace le précédent, il ne s’y ajoute pas', () => {
    const report = new DeadCodeSweepReport();
    report.setScan({ files: [{ uri: uriOf('/w/Old.kt'), findings: [finding('com.x.A')] }], truncated: false });
    report.setScan({ files: [{ uri: uriOf('/w/New.kt'), findings: [finding('com.x.B')] }], truncated: false });
    expect(published(report).has('/w/Old.kt')).toBe(false);
    expect(published(report).has('/w/New.kt')).toBe(true);
    report.dispose();
  });

  it('clear vide le panneau et la mémoire', () => {
    const report = new DeadCodeSweepReport();
    report.setScan({ files: [{ uri: uriOf('/w/A.kt'), findings: [finding('com.x.A')] }], truncated: false });
    report.clear();
    expect(published(report).size).toBe(0);
    expect(report.findingsFor('/w/A.kt')).toBeUndefined();
    report.dispose();
  });
});
