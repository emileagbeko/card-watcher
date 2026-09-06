// Rules-based junk filter. Keeps alerts to actual cards, drops accessories
// (sleeves, binders...) and off-topic fuzzy search matches.

function norm(s) {
  return (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function applyFilter(items, globalFilter = {}, target = {}) {
  const exclude = (globalFilter.excludeKeywords || []).map(norm);
  const requireAny = (target.requireAny || []).map(norm);
  const requireTypeAny = (target.requireTypeAny || []).map(norm);
  const minPrice = globalFilter.minPrice || 0;
  const maxPrice = globalFilter.maxPrice || 0;

  const kept = [];
  const dropped = [];
  for (const item of items) {
    const haystack = norm(
      [item.name, item.brand, item.meta && item.meta.licence, item.meta && item.meta.productType]
        .filter(Boolean)
        .join(' ')
    );
    // Product-type check uses only the site's own category fields, so a
    // "Football Jumper" can't sneak in on its name. Items with no type data
    // get the benefit of the doubt.
    const typeHaystack = norm(
      [item.meta && item.meta.productType, item.meta && item.meta.typeCategory]
        .filter(Boolean)
        .join(' ')
    );
    let reason = null;
    const hit = exclude.find((k) => haystack.includes(k));
    if (hit) reason = `excluded keyword "${hit}"`;
    else if (requireAny.length && !requireAny.some((k) => haystack.includes(k)))
      reason = 'matched none of requireAny';
    else if (
      requireTypeAny.length &&
      typeHaystack &&
      !requireTypeAny.some((k) => typeHaystack.includes(k))
    )
      reason = `product type "${typeHaystack}" not card-related`;
    else if (typeof item.price === 'number') {
      if (minPrice && item.price < minPrice) reason = `below minPrice £${minPrice}`;
      else if (maxPrice && item.price > maxPrice) reason = `above maxPrice £${maxPrice}`;
    }
    if (reason) dropped.push({ item, reason });
    else kept.push(item);
  }
  return { kept, dropped };
}

module.exports = { applyFilter };
