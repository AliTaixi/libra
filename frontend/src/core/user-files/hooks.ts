/**
 * React hooks for per-user shared file management.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  deleteUserFile,
  listUserFiles,
  type ListUserFilesResponse,
} from "./api";

const USER_FILES_KEY = ["user-files", "list"] as const;

/**
 * Hook to list all files in the current user's shared user-data.
 */
export function useUserFiles() {
  return useQuery({
    queryKey: USER_FILES_KEY,
    queryFn: () => listUserFiles(),
  });
}

/**
 * Hook to delete a file from the current user's shared user-data.
 * Uses optimistic update for instant UI feedback.
 */
export function useDeleteUserFile() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (filename: string) => deleteUserFile(filename),

    // Optimistic update: immediately remove file from cache
    onMutate: async (filename: string) => {
      // Cancel any in-flight list queries so they don't overwrite our optimism
      await queryClient.cancelQueries({ queryKey: USER_FILES_KEY });

      // Snapshot previous data for rollback
      const previousData = queryClient.getQueryData<ListUserFilesResponse>(USER_FILES_KEY);

      // Remove the file from the cache
      if (previousData) {
        queryClient.setQueryData<ListUserFilesResponse>(USER_FILES_KEY, {
          ...previousData,
          files: previousData.files.filter((f) => f.filename !== filename),
          count: previousData.count - 1,
        });
      }

      return { previousData };
    },

    // On error, roll back to the previous data
    onError: (_err, _filename, context) => {
      if (context?.previousData) {
        queryClient.setQueryData(USER_FILES_KEY, context.previousData);
      }
    },

    // Always refetch to ensure consistency with server
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: USER_FILES_KEY });
    },
  });
}
