import { useQuery } from "@tanstack/react-query";

import { DEFAULT_REFETCH_INTERVAL } from "@app/Constants";
import { CveFinding, CveStatus, Fact, RhtpaSbom } from "@app/api/models";
import { getFact, getFacts, getFactsBySource } from "@app/api/rest";

const FactsQueryKey = "facts";

export const useFetchFacts = (
  applicationID: number | string | undefined,
  refetchInterval: number | false = DEFAULT_REFETCH_INTERVAL
) => {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: [FactsQueryKey, applicationID],
    queryFn: () =>
      applicationID === undefined
        ? Promise.resolve(undefined)
        : getFacts(applicationID),
    enabled: !!applicationID,
    onError: (error) => console.log("error, ", error),
    select: (facts): Fact[] =>
      facts === undefined
        ? []
        : Object.keys(facts).map((fact) => ({
            name: fact,
            data: facts[fact],
          })),
    refetchInterval,
  });

  return {
    facts: data || [],
    isFetching: isLoading,
    fetchError: error,
    refetch,
  };
};

const CveFindingsQueryKey = "cve-findings";
const RhtpaSbomQueryKey = "rhtpa-sbom";

const IN_PROGRESS: CveStatus[] = ["Detected", "Analyzing", "AgentRunning"];

export const useFetchCveFindings = (applicationID: number | undefined) => {
  const { data, isLoading, error } = useQuery({
    queryKey: [CveFindingsQueryKey, applicationID],
    queryFn: () => getFactsBySource<CveFinding>(applicationID as number, "cve"),
    enabled: applicationID != null,
    select: (facts): CveFinding[] =>
      Object.values(facts ?? {}).sort(
        (a, b) => (b.score ?? 0) - (a.score ?? 0) || a.cve.localeCompare(b.cve)
      ),
    refetchInterval: (findings) =>
      Object.values(findings ?? {}).some((f) => IN_PROGRESS.includes(f.status))
        ? DEFAULT_REFETCH_INTERVAL
        : 6 * DEFAULT_REFETCH_INTERVAL,
  });
  return { findings: data ?? [], isFetching: isLoading, fetchError: error };
};

export const useFetchRhtpaSbom = (applicationID: number | undefined) => {
  const { data, isLoading } = useQuery({
    queryKey: [RhtpaSbomQueryKey, applicationID],
    queryFn: () =>
      getFact<RhtpaSbom>(applicationID as number, "rhtpa", "sbom").catch(
        () => null
      ),
    enabled: applicationID != null,
    refetchInterval: 6 * DEFAULT_REFETCH_INTERVAL,
  });
  return { sbom: data ?? null, isFetching: isLoading };
};
