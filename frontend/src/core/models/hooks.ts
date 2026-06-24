import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { createModel, deleteModel, loadModels, updateModel } from "./api";
import type { ModelCreateRequest, ModelUpdateRequest } from "./types";

export function useModels({ enabled = true }: { enabled?: boolean } = {}) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["models"],
    queryFn: () => loadModels(),
    enabled,
    refetchOnWindowFocus: true,
    staleTime: 0,
  });
  return {
    models: data?.models ?? [],
    tokenUsageEnabled: data?.token_usage.enabled ?? false,
    isLoading,
    error,
  };
}

export function useCreateModel() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: ModelCreateRequest) => createModel(body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["models"], refetchType: "all" });
    },
  });
}

export function useUpdateModel() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ name, body }: { name: string; body: ModelUpdateRequest }) =>
      updateModel(name, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["models"], refetchType: "all" });
    },
  });
}

export function useDeleteModel() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => deleteModel(name),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["models"], refetchType: "all" });
    },
  });
}
