# Demo Design Playbook

> **Comment concevoir, scripter et rendre des démos vidéo d'une qualité
> exceptionnelle pour Kotlin Jump.**
> Ce document combine les principes de design, la structure narrative,
> le style guide et le plan d'amélioration technique. C'est la référence
> permanente — à consulter avant chaque nouvelle démo et avant chaque
> changement du pipeline de recording.

---

## 1. Pourquoi ce doc

Les outils de recording (`scripts/demo/`) ne font pas à eux seuls de belles
démos. La qualité finale dépend beaucoup plus du **scénario** et du **design
d'attention** que des fonctionnalités techniques du recorder.

Ce playbook :
- Définit la structure narrative à suivre
- Pose un style guide cohérent cross-démos
- Prioritise les améliorations techniques par ROI
- Sert de checklist de review avant chaque ship

---

## 2. Règles d'or (non-négociables)

1. **Chaque démo a UN WOW moment identifié avant d'écrire la moindre ligne de code.**
2. **Moins d'éléments à l'écran = mieux.** Budget cognitif : 3-4 choses max.
3. **Lisibilité mobile avant desktop.** 40% des viewers sont sur téléphone.
4. **Fade, pas pop.** Les overlays apparaissent/disparaissent en fade 150 ms.
5. **Mesure avant d'itérer.** Pas de polish sans données avant/après.
6. **Toutes les démos partagent le même design system.** Pas de bikeshedding par démo.

---

## 3. Audience & contexte d'affichage

**Avant de scripter**, identifier où la démo sera affichée. Ça détermine tout le reste.

| Contexte | Durée cible | Ce que le viewer doit comprendre | Priorité narrative |
|---|---|---|---|
| README GitHub | 5-8 s | "Ça vaut 5 min d'essai ?" | WOW moment immédiat |
| Marketplace header | 8-12 s | "J'installe ou pas ?" | Solution + usage typique |
| "What's New" VS Code | 10-15 s | "Qu'est-ce qui est nouveau ?" | Focus sur le NOUVEAU |
| LinkedIn / Twitter | 3-5 s | "Je retweet ?" | Très stylé, autoplay muet |
| Documentation / tutoriel | 20-30 s | "Comment j'utilise ?" | Step-by-step détaillé |

**Chaque démo cible un contexte**. Un même demo ne marche pas partout.

---

## 4. Structure narrative simplifiée

### Pattern recommandé (6-9 secondes)

```
Setup (0-1.5s)   →   Action (1.5-4s)   →   WOW (4-6s)   →   Relief (6-8s)
   ↓                     ↓                   ↓              ↓
"Où on part"        "Ce qu'on fait"      "Le PAYOFF"     "Pourquoi ça
                                                           compte"
```

**Pas de pré-setup long "voilà le problème".** Direct dans l'action. Le viewer
comprend le problème par CONTRASTE avec la solution qu'il voit.

### Exemple — Navigation History

| Phase | Durée | Ce qu'on voit | Ce qu'on lit (overlay) |
|---|---|---|---|
| Setup | 1 s | `ApiServiceImpl.kt` ouvert, curseur sur `fetchUser` L4 C25 | *(rien)* |
| Action | 2 s | Cmd+Click → transition vers `ApiService.kt` L3 | "Cmd+Click → Go to Definition" |
| WOW | 2 s | `Cmd+Opt+←` → retour à **L4 C25 exact**, pas juste le fichier | "⌘+⌥+← Navigate Back" |
| Relief | 1.5 s | Pulse/highlight sur la position restaurée | "Line AND column preserved" |

Total : ~6.5 s. **Court, dense, mémorable.**

### Le WOW moment : règle du contraste

Le WOW est ce que VS Code **ne fait pas nativement**. Trouver cet angle en une
phrase avant d'écrire le script.

| Feature | WOW angle |
|---|---|
| Navigation History | "Revient à la colonne exacte, pas juste au fichier" |
| Find Usages | "N usages, navigables en une touche, scope Kotlin précis" |
| Code Lens | "Le compte est toujours à jour, sans clic" |
| Android Run | "One click, zéro terminal" |
| Go to Class Impl | "Saute directement à l'impl, pas à l'interface" |

---

## 5. Design system (à respecter cross-démos)

### Palette

| Rôle | Couleur | Usage |
|---|---|---|
| Primary action | `#007ACC` (VS Code blue) | Card principal (keystroke, click) |
| Banner background | `#1e1e1e@0.85` | Banner top-left (raccourcis) |
| Accent success | `#4CAF50` | Confirmation d'action réussie |
| Highlight line | `#007ACC@0.18` (pas jaune !) | Flash d'atterrissage |
| Text primary | `#FFFFFF` | Titres overlays |
| Text secondary | `#CCCCCC` | Sous-labels |
| Text code-like | `#D4D4D4` (monospace) | Noms de symboles |

**Abandon du flash jaune actuel** — mauvais signal sémantique (warning = danger).

### Typographie

- **Overlays** : Inter Regular (bundled dans `scripts/demo/fixtures/`), tailles 28-32 pt
- **Code dans overlays** (ex: nom de symbole) : Menlo / SF Mono
- **Label court** : 22-24 pt
- **Caption narrative** : 20 pt
- **Minimum absolu** : 20 pt pour rester lisible quand le WebP est affiché à 50% de taille sur mobile

### Timings

| Événement | Durée | Easing |
|---|---|---|
| Overlay fade in | 150 ms | ease-out |
| Overlay fade out | 150 ms | ease-in |
| Overlay visible (par défaut) | 2500 ms | — |
| Pause entre actions | 800-1200 ms | — |
| Flash d'atterrissage | 500 ms | ease-out |
| Pause au WOW moment | 3000 ms | — (c'est le peak, donner le temps) |
| Fade to end | 500 ms | linear |

### Spacing

Grille de 8 px. Marges multiples de 8. Pas d'alignement arbitraire.

- Banner top-left : x=24, y=24, size 420×72
- Card bottom-center : `(iw-480)/2`, y=560, size 480×96
- Caption bottom : x=40, y=660, full-width-80

### Loop / fin de vidéo

**WebP avec `loop=0` (actuel) = mauvais**. La fin saute brusquement au début.

Trois options, par ordre de préférence :
1. `loop=1` (une seule lecture) + poster frame qui reflète l'état final
2. **Fade to black 500 ms en fin** + loop (crée une coupure naturelle)
3. Dernière frame identique à la première (pas toujours possible)

---

## 6. Lisibilité mobile (règle #3)

### Ce qui tue la lisibilité sur téléphone

- Font VS Code à 14 pt → 7 pt effectifs sur mobile → illisible
- File explorer à gauche → 20% d'écran gaspillé → code encore plus petit
- Minimap visible → autre bruit
- Tabs multiples → texte mini

### Fix dans `scripts/demo/fixtures/demo-settings.json`

```json
{
  "editor.fontSize": 18,
  "editor.lineHeight": 28,
  "workbench.activityBar.location": "hidden",
  "workbench.statusBar.visible": false,
  "workbench.editor.showTabs": "none",
  "editor.minimap.enabled": false,
  "breadcrumbs.enabled": false,
  "editor.scrollbar.vertical": "hidden",
  "editor.scrollbar.horizontal": "hidden"
}
```

### File explorer : à cacher par défaut

Dans `Stage.waitForIndexReady()` :

```typescript
await vscode.commands.executeCommand('workbench.action.closeSidebar');
```

L'exposer uniquement via un helper explicite quand la démo en a VRAIMENT besoin
(demo "Find Usages" par exemple) :

```typescript
await stage.showExplorer();  // opt-in, pas opt-out
```

### Tabs : conditionnel

- **Demo sur un seul fichier** → tabs cachées
- **Demo cross-fichier** → tabs visibles (aide à comprendre "on est passé de A.kt à B.kt")

API proposée :

```typescript
await stage.showTabs();  // active tabs pour cette démo
```

---

## 7. Cognitive load : budget de 3-4 éléments

Lister tout ce qui est visible à un instant T. Si ça dépasse 4, **retirer** jusqu'à être à 3.

### Exemple — démo actuel

1. ~~File explorer~~ (retirer)
2. Code
3. Cursor position
4. ~~Tab bar~~ (conditionnel)
5. Overlay card
6. Overlay sublabel
7. ~~Flash line highlight~~ (remplacer par underline inline — section 8)

Après simplification : **code + cursor + 1 overlay = 3 éléments**. 

### Règle de composition

À tout instant :
- **1 zone principale** (le code, 70-80% de l'écran)
- **1 annotation contextuelle** (card ou banner)
- **1 indicateur d'action** (cursor glow, underline inline)

Pas plus.

---

## 8. Inline decorations sur le code (préféré aux overlays externes)

Les overlays flottent AU-DESSUS du code → le viewer doit regarder 2 endroits.
Les decorations inline s'intègrent AU code → le viewer regarde 1 endroit.

**Plus impactant**, **moins intrusif**, **plus professionnel**.

### Types de decorations à utiliser

| Decoration | Usage | API VS Code |
|---|---|---|
| Underline animé progressif | "Regarde ICI avant l'action" | `TextEditorDecorationType` avec `borderWidth` |
| Highlight ligne (thin, pas pleine) | Atterrissage après navigation | `borderWidth: 0 0 0 3px`, border gauche seulement |
| Ghost text inline | "← restauré ici" | `before`/`after` avec `contentText` |
| Halo autour du cursor | Indicateur de position | Custom `CSS filter` via `textDecoration` |
| Strikethrough éphémère | "Cette ligne n'existe plus" | `textDecoration: 'line-through'` |

### Exemple d'implémentation (à ajouter à `Stage`)

```typescript
/** Animated underline under a symbol — draws attention BEFORE the action. */
async highlightSymbol(line: number, from: number, to: number): Promise<void> {
  const deco = vscode.window.createTextEditorDecorationType({
    borderWidth: '0 0 2px 0',
    borderStyle: 'solid',
    borderColor: '#007ACC',
  });
  vscode.window.activeTextEditor?.setDecorations(deco, [
    new vscode.Range(line, from, line, to),
  ]);
  await this.pause(600);
  deco.dispose();
}

/** Ghost annotation after an action — "← restored here". */
async ghostNote(line: number, col: number, text: string, duration = 1500): Promise<void> {
  const deco = vscode.window.createTextEditorDecorationType({
    after: {
      contentText: `  ← ${text}`,
      color: '#4CAF50',
      fontStyle: 'italic',
    },
  });
  vscode.window.activeTextEditor?.setDecorations(deco, [
    new vscode.Range(line, col, line, col),
  ]);
  await this.pause(duration);
  deco.dispose();
}
```

### Remplacement du flash jaune

Actuellement `flashLanding()` met une bande jaune pleine-ligne pendant 900 ms.
**Remplacer** par un pulse plus subtil :

```typescript
private async flashLanding(editor: vscode.TextEditor, line: number): Promise<void> {
  const deco = vscode.window.createTextEditorDecorationType({
    isWholeLine: false,              // ← pas pleine ligne
    borderWidth: '0 0 0 3px',        // ← bande verticale gauche uniquement
    borderStyle: 'solid',
    borderColor: '#007ACC',          // ← bleu primary, pas jaune
    backgroundColor: 'rgba(0, 122, 204, 0.12)',  // halo très léger
    overviewRulerColor: '#007ACC',
    overviewRulerLane: vscode.OverviewRulerLane.Full,
  });
  editor.setDecorations(deco, [new vscode.Range(line, 0, line, 0)]);
  await this.pause(500);
  deco.dispose();
}
```

---

## 9. API Stage v2 (structure narrative)

L'API actuelle (`openFile`, `click`, `keystroke`, `caption`) est mécaniste.
V2 encourage la structure narrative.

```typescript
export default async function record(stage: Stage): Promise<void> {
  await stage.waitForIndexReady();

  // Setup (0-1.5s) : poser le contexte
  await stage.openFile('data/ApiServiceImpl.kt', { line: 4, column: 25 });
  await stage.highlightSymbol(4, 25, 34);        // underline sous fetchUser

  // Action (1.5-4s) : l'étape technique
  await stage.act('Cmd+Click → Go to Definition');
  await stage.waitForEditor('ApiService.kt', 3);

  // WOW (4-6s) : le payoff — donner du temps
  await stage.peak('⌘+⌥+← Navigate Back', { hold: 3000 });
  await stage.runCommand('kotlinJump.navigateBack');
  await stage.waitForEditor('ApiServiceImpl.kt', 4);

  // Relief (6-8s) : pourquoi ça compte
  await stage.ghostNote(4, 60, 'Line AND column restored');
}
```

Les noms `setup`/`act`/`peak`/`ghostNote` rendent la structure narrative
visible en lisant le code. Chaque fonction applique le timing et styling
du design system automatiquement.

---

## 10. Priorisation des améliorations techniques

### P0 — Fondations (retour immédiat, ~4h)

| # | Item | Effort | Impact |
|---|---|---|---|
| P0.1 | Font size 14 → 18, hide activity/status/tabs | 15 min | ⭐⭐⭐⭐⭐ lisibilité mobile |
| P0.2 | Close sidebar par défaut, `stage.showExplorer()` opt-in | 20 min | ⭐⭐⭐⭐ moins de bruit |
| P0.3 | Flash jaune → pulse bleu 500 ms (section 8) | 30 min | ⭐⭐⭐⭐ sémantique correcte |
| P0.4 | Pacing 1.5s → 2.5s défaut ; peak à 3s | 15 min | ⭐⭐⭐⭐⭐ compréhension |
| P0.5 | Loop : fade-to-dark 500 ms en fin | 30 min | ⭐⭐⭐ transition graceful |
| P0.6 | Fade in/out overlays 150 ms | 45 min | ⭐⭐⭐ polish perceptible |
| P0.7 | Design system appliqué (palette + spacing) | 1 h | ⭐⭐⭐⭐ cohérence |

### P1 — Narrative & inline decorations (~4h)

| # | Item | Effort | Impact |
|---|---|---|---|
| P1.1 | API Stage v2 : `setup`, `act`, `peak`, `ghostNote`, `highlightSymbol` | 2 h | ⭐⭐⭐⭐⭐ structure |
| P1.2 | Refactor navigation-history en structure narrative v2 | 30 min | ⭐⭐⭐⭐ premier exemple |
| P1.3 | Tabs conditionnelles (`stage.showTabs()`) | 30 min | ⭐⭐⭐ contexte multi-fichier |
| P1.4 | Cursor glow via decoration | 45 min | ⭐⭐⭐ suivi visuel |

### P2 — Polish avancé (~3h, optionnel)

| # | Item | Effort | Impact |
|---|---|---|---|
| P2.1 | Drop shadow sous overlays | 20 min | ⭐⭐ |
| P2.2 | Border subtil autour du WebP (pour README GitHub) | 30 min | ⭐⭐⭐ contexte isolé |
| P2.3 | Export MP4 parallèle (meilleure qualité pour LinkedIn) | 1 h | ⭐⭐ audience spécifique |
| P2.4 | Step counter / progress bar discret | 1 h | ⭐⭐ démo longue uniquement |

### P3 — À NE PAS faire (over-engineering)

- Click ripple visible (complexe, peu visible)
- Background gradient décoratif (c'est à la page hôte)
- macOS window chrome décoratif (double encadrement)
- Zoom dynamique ffmpeg (fragile)
- Animation typewriter (pas pertinent pour nos démos)
- TTS voiceover (WebP sans audio)
- Watermark "Made with Kotlin Jump" (amateur)

---

## 11. Quand NE PAS faire de vidéo

Toutes les features ne méritent pas une démo animée. Si **une alternative statique raconte mieux l'histoire**, choisir celle-là.

| Type de feature | Meilleur format |
|---|---|
| Setting booléen | Screenshot avant/après side-by-side |
| Keyboard shortcut | Table markdown |
| Fichier de syntax highlighting | Screenshot annoté |
| Bug fix sans comportement nouveau | Texte release notes |
| Nouvelle action cross-fichier | ✅ Vidéo |
| Refactor complexe multi-étapes | ✅ Vidéo |
| Navigation rapide | ✅ Vidéo |
| Workflow en plusieurs clics | ✅ Vidéo |

**Règle** : si tu peux raconter l'histoire en une capture + 2 annotations, fais ça. Une mauvaise vidéo est pire qu'une bonne capture.

---

## 12. Mesure & itération

Pas de polish sans données avant/après. Sinon on optimise à l'aveugle.

### Métriques à tracker

| Métrique | Source | Cible |
|---|---|---|
| Installs/week | Marketplace dashboard | Tendance up |
| Stars/week | GitHub Insights | Tendance up |
| README views | GitHub Insights → Traffic | Tendance up après ship |
| Extension listing views | Marketplace dashboard | Plus de vues après nouveaux demos |

### Process d'itération

```
1. Baseline (2 semaines sans nouvelle démo)
2. Ship démo v1
3. Mesurer 2 semaines
4. Si amélioration mesurable → itérer P1
5. Si pas d'amélioration → les démos sont "assez bonnes", STOP
```

Ne jamais itérer en aveugle. Le coût marginal monte, le bénéfice marginal descend.

---

## 13. Checklist pré-ship (par démo)

Avant de committer une nouvelle démo :

**Narrative**
- [ ] J'ai identifié le WOW moment en une phrase
- [ ] La démo suit Setup → Action → WOW → Relief
- [ ] La durée totale est 5-12 s (8 s idéal)
- [ ] Le peak a 3 s pour respirer

**Lisibilité**
- [ ] Font VS Code ≥ 16 pt dans les fixtures
- [ ] Overlays ≥ 22 pt
- [ ] Test réel sur iPhone ou simulateur
- [ ] File explorer caché (sauf si la démo le nécessite)

**Charge cognitive**
- [ ] ≤ 4 éléments visibles à tout instant
- [ ] 1 overlay actif à la fois (pas 2)
- [ ] Pas de chrome décoratif

**Style system**
- [ ] Couleurs respectent la palette (pas de jaune pour info)
- [ ] Timings suivent les valeurs par défaut
- [ ] Fade in/out appliqué aux overlays

**Fin / loop**
- [ ] `loop=1` OU fade-to-dark à la fin
- [ ] Dernière frame lisible indépendamment

**Grep de sécurité** (voir `.publish` safety net)
- [ ] Aucun terme dev-only dans le contenu affiché

---

## 14. Accessibilité

Souvent oublié, facile à améliorer.

| Problème | Fix |
|---|---|
| WebP animé n'a pas de "pause" | Fournir un screenshot statique en fallback (`<img src="demo.webp" alt="..." />` + description détaillée dans alt ou aria-describedby) |
| Pas de captions pour sourds | Les overlays text sont déjà des "captions". Vérifier qu'ils restent 2.5 s pour lecture lente |
| Contraste texte | Minimum 4.5:1 (WCAG AA). Blanc sur #007ACC = 5.2:1 ✓ |
| Daltonisme | Éviter rouge/vert seuls pour distinguer. Notre palette bleu/gris OK |
| Motion sensitivity | Fournir une version statique pour `prefers-reduced-motion` (poster frame seulement) |

### Implémentation minimale

README :
```markdown
<picture>
  <source media="(prefers-reduced-motion: reduce)" srcset="media/demos/navigation-history-poster.png">
  <img src="media/demos/navigation-history.webp" alt="Navigation history: Cmd+Opt+Left returns to the exact line and column, not just the file">
</picture>
```

---

## 15. Résumé ultra-court (le playbook en 10 règles)

1. **WOW moment identifié avant d'écrire le script.**
2. **Structure : Setup → Action → WOW → Relief.** 6-9 s total.
3. **Max 3-4 éléments visibles.** Cacher tout ce qui ne sert pas la story.
4. **Font VS Code 18 pt, overlays 22-28 pt.** Mobile first.
5. **Inline decorations > overlays externes** quand possible.
6. **Palette bleu primaire (#007ACC) + noir + blanc.** Pas de jaune pour info.
7. **Fade 150 ms.** Pas d'apparition brute.
8. **Peak = 3 s de hold.** Tout le reste = 1.5-2.5 s.
9. **Loop graceful** : fade-to-dark ou `loop=1`.
10. **Mesurer avant de polir plus.** Pas de polish aveugle.

---

## 16. Fichiers liés

- `doc/demo-recording.md` — Comment UTILISER le pipeline (sans le concevoir)
- `scripts/demo/lib/stage.ts` — Stage API actuelle, à étendre selon section 9
- `scripts/demo/lib/overlay.ts` — ffmpeg filter generator, à étendre avec fade
- `scripts/demo/fixtures/demo-settings.json` — à ajuster selon section 6
- `scripts/demo/demos/*.demo.ts` — chaque démo respecte ce playbook
