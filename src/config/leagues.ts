export interface LeagueConfig {
  name: string;
  slug: string;
  uniqueTournamentId: number;
}

export const LEAGUES: LeagueConfig[] = [
  { name: 'Premier League', slug: 'premier-league', uniqueTournamentId: 17 },
  { name: 'La Liga', slug: 'laliga', uniqueTournamentId: 8 },
  { name: 'Bundesliga', slug: 'bundesliga', uniqueTournamentId: 35 },
  { name: 'Serie A', slug: 'serie-a', uniqueTournamentId: 23 },
  { name: 'Ligue 1', slug: 'ligue-1', uniqueTournamentId: 34 },
  { name: 'Champions League', slug: 'uefa-champions-league', uniqueTournamentId: 7 },
];

export function findLeague(nameOrSlug: string): LeagueConfig | undefined {
  const q = nameOrSlug.toLowerCase();
  return LEAGUES.find(
    (l) => l.name.toLowerCase() === q || l.slug === q
  );
}
