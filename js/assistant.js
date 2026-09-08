// assistant.js — a rules-based deck assistant.
// It never calls an external AI service: every suggestion is derived from
// patterns (mana curve, removal, draw, ramp, tags, land count) found in the
// cards you've actually entered into your own Codex.

const REMOVAL_RE = /destroy target|exile target|(-\d+\/-\d+).*target|deals? \d+ damage to target|fight target|sacrifice[s]? a creature|gets? -\d+\/-\d+/i;
const DRAW_RE = /draw (a|two|three|four|\d+) cards?/i;
const RAMP_RE = /search your library for a .*land|add \{[wubrgc0-9]\}|adds? \{?[wubrgc]\}? ?mana|additional land/i;
const WRATH_RE = /destroy all creatures|each creature gets -\d+\/-\d+|all creatures.*destroy/i;

function isLand(card) {
  return (card.typeLine || "").includes("Land");
}

function colorIdentityOf(cards) {
  const set = new Set();
  cards.forEach((c) => (c.colorIdentity || c.colors || []).forEach((col) => set.add(col)));
  return set;
}

function fitsColors(card, identitySet) {
  const cols = card.colorIdentity && card.colorIdentity.length ? card.colorIdentity : card.colors || [];
  if (cols.length === 0) return true; // colorless fits anywhere
  return cols.every((c) => identitySet.has(c));
}

function curveBuckets(nonlandDeckCards) {
  const buckets = { "0-1": 0, "2": 0, "3": 0, "4": 0, "5": 0, "6+": 0 };
  nonlandDeckCards.forEach((c) => {
    const cmc = c.cmc || 0;
    if (cmc <= 1) buckets["0-1"]++;
    else if (cmc === 2) buckets["2"]++;
    else if (cmc === 3) buckets["3"]++;
    else if (cmc === 4) buckets["4"]++;
    else if (cmc === 5) buckets["5"]++;
    else buckets["6+"]++;
  });
  return buckets;
}

/**
 * @param {object} deck - deck record from Storage
 * @param {object[]} deckCardObjects - full card objects currently in the deck, each with .quantity (in-deck count)
 * @param {object[]} collection - all cards in the collection, each with .quantity (owned count)
 * @param {number} targetSize - total deck size the format expects (60 constructed, 99+1 commander, etc.)
 */
function analyzeDeck(deck, deckCardObjects, collection, targetSize = 60, offset = 0) {
  const suggestions = [];
  const identity = colorIdentityOf(deckCardObjects);
  const deckIds = new Set(deckCardObjects.map((c) => c.id));

  const usedQty = {};
  deck.cards.forEach((dc) => (usedQty[dc.cardId] = dc.quantity));

  const candidates = collection.filter((c) => {
    if (deckIds.has(c.id) && !isLand(c)) {
      // still allow suggesting more copies of a card already partially used, if owned > used
      return (c.quantity || 0) > (usedQty[c.id] || 0);
    }
    return !deckIds.has(c.id) && fitsColors(c, identity);
  });

  const nonlandDeck = deckCardObjects.filter((c) => !isLand(c));
  const landDeck = deckCardObjects.filter((c) => isLand(c));

  const deckSize = deckCardObjects.reduce((sum, c) => sum + (usedQty[c.id] || 1), 0);

  // 1. Removal check
  const removalInDeck = nonlandDeck.filter((c) => REMOVAL_RE.test(c.oracleText || "")).length;
  const targetRemoval = Math.max(4, Math.round(targetSize * 0.12));
  if (removalInDeck < targetRemoval) {
    const pool = candidates.filter((c) => !isLand(c) && REMOVAL_RE.test(c.oracleText || ""));
    pool.slice(offset, offset + 3).forEach((c) =>
      suggestions.push({
        cardId: c.id,
        name: c.name,
        reason: `Only ${removalInDeck} removal-style effect(s) so far — this deals with an opposing threat.`,
        priority: 1,
      })
    );
  }

  // 2. Card draw check
  const drawInDeck = nonlandDeck.filter((c) => DRAW_RE.test(c.oracleText || "")).length;
  const targetDraw = Math.max(3, Math.round(targetSize * 0.08));
  if (drawInDeck < targetDraw) {
    const pool = candidates.filter((c) => !isLand(c) && DRAW_RE.test(c.oracleText || ""));
    pool.slice(offset, offset + 2).forEach((c) =>
      suggestions.push({
        cardId: c.id,
        name: c.name,
        reason: `Light on card advantage (${drawInDeck} draw effects) — helps you refuel.`,
        priority: 2,
      })
    );
  }

  // 3. Mana curve gaps
  const buckets = curveBuckets(nonlandDeck);
  const total = nonlandDeck.length || 1;
  const targetShape = { "0-1": 0.12, "2": 0.22, "3": 0.2, "4": 0.16, "5": 0.12, "6+": 0.1 };
  Object.entries(targetShape).forEach(([bucket, targetPct]) => {
    const actualPct = buckets[bucket] / total;
    if (actualPct < targetPct - 0.06) {
      const pool = candidates.filter((c) => {
        if (isLand(c)) return false;
        const cmc = c.cmc || 0;
        if (bucket === "0-1") return cmc <= 1;
        if (bucket === "6+") return cmc >= 6;
        return String(cmc) === bucket;
      });
      pool.slice(offset, offset + 1).forEach((c) =>
        suggestions.push({
          cardId: c.id,
          name: c.name,
          reason: `Your curve is thin at ${bucket === "6+" ? "6+ mana" : bucket + " mana"} — fills that slot.`,
          priority: 3,
        })
      );
    }
  });

  // 4. Ramp (relevant once green is in the identity, or curve skews high)
  const highCurve = (buckets["5"] + buckets["6+"]) / total > 0.25;
  if (identity.has("G") || highCurve) {
    const rampInDeck = nonlandDeck.filter((c) => RAMP_RE.test(c.oracleText || "")).length;
    if (rampInDeck < 3) {
      const pool = candidates.filter((c) => !isLand(c) && RAMP_RE.test(c.oracleText || ""));
      pool.slice(offset, offset + 2).forEach((c) =>
        suggestions.push({
          cardId: c.id,
          name: c.name,
          reason: `Curve runs high and ramp is light (${rampInDeck}) — accelerates you there.`,
          priority: 4,
        })
      );
    }
  }

  // 5. Board wipe for control-leaning decks (lots of removal/draw already)
  if (removalInDeck + drawInDeck >= Math.round(targetSize * 0.18)) {
    const hasWrath = nonlandDeck.some((c) => WRATH_RE.test(c.oracleText || ""));
    if (!hasWrath) {
      const pool = candidates.filter((c) => !isLand(c) && WRATH_RE.test(c.oracleText || ""));
      pool.slice(offset, offset + 1).forEach((c) =>
        suggestions.push({
          cardId: c.id,
          name: c.name,
          reason: "Deck leans controlling but has no board wipe yet.",
          priority: 5,
        })
      );
    }
  }

  // 6. Land count
  const landTargetPct = targetSize >= 90 ? 0.37 : 0.4; // rough Commander vs. 60-card norm
  const landTarget = Math.round(targetSize * landTargetPct);
  const landCount = landDeck.reduce((s, c) => s + (usedQty[c.id] || 1), 0);
  if (landCount < landTarget - 1) {
    const pool = candidates.filter((c) => isLand(c));
    pool.slice(offset, offset + 3).forEach((c) =>
      suggestions.push({
        cardId: c.id,
        name: c.name,
        reason: `Only ${landCount} lands for a ${targetSize}-card deck (aim for ~${landTarget}).`,
        priority: 2,
      })
    );
  }

  // 7. Tag synergy — if 2+ cards in the deck share a tag, surface others with
  // that tag. Tags include both your own custom tags and ones Scryfall
  // supplies automatically (keyword abilities, creature/land subtypes).
  const tagsOf = (c) => [...(c.tags || []), ...(c.autoTags || [])];
  const tagCounts = {};
  deckCardObjects.forEach((c) => tagsOf(c).forEach((t) => (tagCounts[t] = (tagCounts[t] || 0) + 1)));
  Object.entries(tagCounts)
    .filter(([, count]) => count >= 2)
    .forEach(([tag]) => {
      const pool = candidates.filter((c) => tagsOf(c).includes(tag));
      pool.slice(offset, offset + 2).forEach((c) =>
        suggestions.push({
          cardId: c.id,
          name: c.name,
          reason: `Shares your "${tag}" tag with ${tagCounts[tag]} card(s) already in the deck.`,
          priority: 6,
        })
      );
    });

  // Dedup by cardId, keep highest-priority (lowest number) reason, cap the list
  const byId = new Map();
  suggestions
    .sort((a, b) => a.priority - b.priority)
    .forEach((s) => {
      if (!byId.has(s.cardId)) byId.set(s.cardId, s);
    });

  return {
    deckSize,
    curve: buckets,
    removalInDeck,
    drawInDeck,
    landCount,
    suggestions: Array.from(byId.values()).slice(0, 12),
  };
}

/**
 * Builds Scryfall search queries for the "all Magic cards" assistant mode —
 * used when the person wants suggestions beyond their own collection.
 * Results are sorted by Scryfall's order:edhrec, i.e. EDHREC popularity rank,
 * which is how EDHREC's signal gets folded in without scraping their site.
 */
function buildAllCardsQueries(analysis, identity, targetSize) {
  const idPart = identity && identity.size ? `id<=${Array.from(identity).join("").toLowerCase()}` : "";
  const queries = [];

  const targetRemoval = Math.max(4, Math.round(targetSize * 0.12));
  if (analysis.removalInDeck < targetRemoval) {
    queries.push({
      label: "Removal",
      reason: `Only ${analysis.removalInDeck} removal-style effect(s) in the deck.`,
      query: `${idPart} -t:land (o:"destroy target" or o:"exile target creature" or o:"damage to target creature")`.trim(),
    });
  }

  const targetDraw = Math.max(3, Math.round(targetSize * 0.08));
  if (analysis.drawInDeck < targetDraw) {
    queries.push({
      label: "Card draw",
      reason: `Only ${analysis.drawInDeck} card-draw effect(s) in the deck.`,
      query: `${idPart} -t:land o:"draw a card"`.trim(),
    });
  }

  const curveTotal = Object.values(analysis.curve).reduce((a, b) => a + b, 0) || 1;
  const highCurve = (analysis.curve["5"] + analysis.curve["6+"]) / curveTotal > 0.25;
  if (identity.has("G") || highCurve) {
    queries.push({
      label: "Ramp",
      reason: "Curve runs high, or the deck is green — mana acceleration helps.",
      query: `${idPart} -t:land (o:"search your library for a land" or o:"add {c}{c}" or o:"add two mana")`.trim(),
    });
  }

  const landTargetPct = targetSize >= 90 ? 0.37 : 0.4;
  const landTarget = Math.round(targetSize * landTargetPct);
  if (analysis.landCount < landTarget - 1) {
    queries.push({
      label: "Lands",
      reason: `Only ${analysis.landCount} lands for a ${targetSize}-card deck.`,
      query: `${idPart} t:land`.trim(),
    });
  }

  return queries;
}

export const Assistant = { analyzeDeck, buildAllCardsQueries, colorIdentityOf };
