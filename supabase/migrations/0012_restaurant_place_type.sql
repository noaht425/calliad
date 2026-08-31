-- Beli separates a place's *type* (restaurant / café / bakery / dessert / bar)
-- from its cuisine. `category` already holds cuisine; add place_type so a
-- "somewhere for dessert" ask and the "cuisines he scores highest" rollup stay
-- distinct.
alter table restaurant_prefs
  add column place_type text
    check (place_type in ('restaurant', 'cafe', 'bakery', 'dessert', 'bar', 'other'));
