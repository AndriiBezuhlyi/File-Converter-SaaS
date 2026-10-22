import {
  queryOptions,
  useIsMutating,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import type { AccountGateway, SettingsGateway } from './account-gateway';

export function profileQuery(gateway: AccountGateway) {
  return queryOptions({
    queryKey: ['account', gateway.scope, 'profile'],
    queryFn: ({ signal }) => gateway.readProfile(signal),
    retry: false,
  });
}
export function settingsQuery(gateway: SettingsGateway) {
  return queryOptions({
    queryKey: ['settings', gateway.scope],
    queryFn: ({ signal }) => gateway.readSettings(signal),
    retry: false,
  });
}
export function useAutoSave(gateway: SettingsGateway) {
  const client = useQueryClient();
  const options = settingsQuery(gateway);
  const settings = useQuery(options);
  const mutationKey = ['settings', gateway.scope, 'auto-save'];
  const pending = useIsMutating({ mutationKey }) > 0;
  const mutation = useMutation({
    mutationKey,
    mutationFn: (value: boolean) => gateway.setAutoSave(value),
    retry: false,
    gcTime: 0,
    onMutate: () => client.cancelQueries({ queryKey: options.queryKey }),
    onSuccess: async (result) => {
      await client.cancelQueries({ queryKey: options.queryKey });
      client.setQueryData(options.queryKey, result);
    },
    onError: () => client.invalidateQueries({ queryKey: options.queryKey }),
  });
  function change(value: boolean) {
    if (!settings.data || settings.isError || client.isMutating({ mutationKey })) return;
    mutation.mutate(value);
  }
  return { settings, pending, change, error: mutation.error };
}
