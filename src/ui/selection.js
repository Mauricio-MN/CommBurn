export function selectOne(currentIds, id, { additive = false, toggle = false, keepExisting = false } = {}) {
  const selected = new Set(currentIds);
  if (toggle && selected.has(id)) {
    selected.delete(id);
  } else if (keepExisting && selected.has(id)) {
    return [...selected];
  } else if (additive) {
    selected.add(id);
  } else {
    return [id];
  }
  return [...selected];
}

export function selectMany(currentIds, ids, { additive = false } = {}) {
  const selected = additive ? new Set(currentIds) : new Set();
  for (const id of ids) selected.add(id);
  return [...selected];
}
