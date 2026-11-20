'use client';

import { createModal, type ModalInstance } from '@lobehub/ui';
import { type FormInstance } from '@lobehub/ui/form';
import { t } from 'i18next';

import ModelConfigContent from './Content';
import ModelConfigFooter from './Footer';

interface ModelConfigModalOptions {
  id: string;
  parametersOnly?: boolean;
  showDeployName?: boolean;
}

export const createModelConfigModal = (options: ModelConfigModalOptions): ModalInstance => {
  const formRef: { current?: FormInstance } = {};

  return createModal({
    content: (
      <ModelConfigContent
        id={options.id}
        parametersOnly={options.parametersOnly}
        showDeployName={options.showDeployName}
        showRequestParameters={true}
        onFormReady={(instance) => {
          formRef.current = instance;
        }}
      />
    ),
    footer: (
      <ModelConfigFooter
        formRef={formRef}
        id={options.id}
        parametersOnly={options.parametersOnly}
        showDeployName={options.showDeployName}
        showRequestParameters={true}
      />
    ),
    maskClosable: true,
    title: t('llm.customModelCards.modelConfig.modalTitle', { ns: 'setting' }),
    width: 'min(90vw, 640px)',
  });
};
