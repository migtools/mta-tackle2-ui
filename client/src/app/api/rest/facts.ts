import axios from "axios";

import { hub } from "../rest";

export const getFacts = (id: number | string) =>
  axios
    .get<Record<string, unknown>>(hub`/applications/${id}/facts`)
    .then((response) => response.data);

/**
 * Facts written by an addon under a source (e.g. `cve`) are only returned by
 * the sourced endpoint: `/applications/:id/facts/<source>:`.
 */
export const getFactsBySource = <T = unknown>(
  id: number | string,
  source: string
) =>
  axios
    .get<Record<string, T>>(hub`/applications/${id}/facts/${source}:`)
    .then((response) => response.data);

export const getFact = <T = unknown>(
  id: number | string,
  source: string,
  key: string
) =>
  axios
    .get<T>(hub`/applications/${id}/facts/${source}:${key}`)
    .then((response) => response.data);
