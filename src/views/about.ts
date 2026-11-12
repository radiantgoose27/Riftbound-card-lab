import type { Meta } from '../types.ts'

export function renderAbout(view: HTMLElement, meta: Meta) {
  const t = meta.thresholds
  view.innerHTML = `
    <article class="prose">
      <h2>How the numbers are made</h2>

      <h3>Data</h3>
      <p>Tournament results come from the <a href="https://topdeck.gg" target="_blank" rel="noopener">TopDeck.gg</a>
      API: round-by-round pairings and the decklists players submitted. Only events where players
      submitted structured decklists contribute to card analysis. Legend win rates also use matches
      where only the legend is known. Player identities are anonymized before analysis and never shown.</p>

      <h3>Meta periods</h3>
      <p>Card strength shifts with every set, so results are split by set release. A new period starts at
      the first event where at least three decks play cards from the new set. “All time” pools every period.</p>

      <h3>Legend win rates</h3>
      <p>Match win rate (not game win rate), with mirror matches removed because they are always 50%.
      Intervals are 95% Wilson intervals.</p>

      <h3>Card effects</h3>
      <p>For each legend and card, matches are split into decks that include the card (in the main deck,
      as the champion, or as a battlefield) and decks that don't.</p>
      <ul>
        <li><strong>Raw diff</strong> is simply win rate with minus win rate without.</li>
        <li><strong>Effect</strong> comes from a logistic regression of match result on card inclusion,
        controlling for the opponent's legend, the player's skill, and whether the match was in top cut
        (plus the set period, for “All time”). It is reported as the average change in predicted win rate.</li>
        <li><strong>Player skill</strong> is a player's win rate in <em>other</em> events, shrunk toward 50%
        when they have played few matches. This keeps strong players from making their favorite cards look good.</li>
        <li>Confidence intervals are clustered by deck, because the matches one deck plays are not independent.</li>
        <li>A card is estimated only with at least ${t.min_side_decks} decks and ${t.min_side_matches} matches both
        with and without it. Cards seen in fewer than ${t.min_card_decks} decks are not listed.</li>
      </ul>

      <h3>Evidence labels</h3>
      <p>With hundreds of cards tested, some will look strong by luck. Each legend's p-values are corrected
      with the Benjamini–Hochberg procedure, giving a q value:</p>
      <ul>
        <li><strong>Strong evidence</strong>: q &lt; 0.05</li>
        <li><strong>Suggestive</strong>: q &lt; 0.20</li>
        <li><strong>Inconclusive</strong>: anything higher. The card may matter, but the data can't tell.</li>
      </ul>

      <h3>Caveats</h3>
      <ul>
        <li>These are associations. A card can travel with a better overall build, a favorable local meta,
        or a ban-list change inside a period, and no adjustment removes all of that.</li>
        <li>Tournament players who submit decklists are not a random sample of all Riftbound players.</li>
        <li>Sideboard cards are not analyzed.</li>
      </ul>
    </article>`
}
