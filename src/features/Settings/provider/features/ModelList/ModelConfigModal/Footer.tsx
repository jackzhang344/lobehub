'use client';

import { Button, ModalFooter, toast, useModalContext } from '@lobehub/ui';
import { type FormInstance } from '@lobehub/ui/form';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useAiInfraStore } from '@/store/aiInfra';

import { pickModelConfigFormValues } from './utils';

interface ModelConfigFooterProps {
  formRef: { current?: FormInstance };
  id: string;
  parametersOnly?: boolean;
  showDeployName?: boolean;
  showRequestParameters?: boolean;
}

const ModelConfigFooter = memo<ModelConfigFooterProps>(
  ({ formRef, id, parametersOnly, showDeployName, showRequestParameters }) => {
    const { t } = useTranslation(['common', 'error', 'modelProvider']);
    const { close } = useModalContext();
    const [loading, setLoading] = useState(false);
    const [editingProvider, updateAiModelsConfig] = useAiInfraStore((s) => [
      s.activeAiProvider!,
      s.updateAiModelsConfig,
    ]);

    return (
      <ModalFooter>
        <Button onClick={close}>{t('cancel', { ns: 'common' })}</Button>
        <Button
          loading={loading}
          type="primary"
          onClick={async () => {
            const form = formRef.current;
            if (!editingProvider || !id || !form) return;
            let data: ReturnType<typeof pickModelConfigFormValues>;
            try {
              data = pickModelConfigFormValues(form.getValues(), {
                parametersOnly,
                showDeployName,
                showRequestParameters,
              });
            } catch (error) {
              toast.error(
                t('providerModels.item.modelConfig.requestParameters.invalid', {
                  ns: 'modelProvider',
                  reason: error instanceof Error ? error.message : '',
                }),
              );
              return;
            }

            setLoading(true);
            try {
              await updateAiModelsConfig(id, editingProvider, data);
              close();
            } catch (error) {
              console.error(error);
              toast.error(t('saveState.saveFailed', { ns: 'error' }));
            } finally {
              setLoading(false);
            }
          }}
        >
          {t('ok', { ns: 'common' })}
        </Button>
      </ModalFooter>
    );
  },
);

export default ModelConfigFooter;
