'use client';

import { Form, type FormInstance, type FormValues, useForm } from '@lobehub/ui/form';
import isEqual from 'fast-deep-equal';
import { memo, useEffect } from 'react';

import { aiModelSelectors, useAiInfraStore } from '@/store/aiInfra';

import ModelConfigForm from '../CreateNewModelModal/Form';
import { RequestParameterFields } from './RequestParameterFields';
import { toRequestParameterRows } from './utils';

interface ModelConfigContentProps {
  id: string;
  onFormReady: (instance: FormInstance) => void;
  parametersOnly?: boolean;
  showDeployName?: boolean;
  showRequestParameters?: boolean;
}

const ModelConfigContent = memo<ModelConfigContentProps>(
  ({ id, parametersOnly, showDeployName, showRequestParameters, onFormReady }) => {
    const model = useAiInfraStore(aiModelSelectors.getAiModelById(id), isEqual);

    const parameterForm = useForm<FormValues>({
      initialValues: { requestParameterRows: toRequestParameterRows(model?.config) },
    });
    useEffect(() => {
      if (parametersOnly) onFormReady(parameterForm);
    }, [parametersOnly, parameterForm, onFormReady]);

    if (parametersOnly) {
      return (
        <Form form={parameterForm} layout={'vertical'}>
          <RequestParameterFields form={parameterForm} />
        </Form>
      );
    }

    return (
      <ModelConfigForm
        idEditable={false}
        initialValues={model}
        showDeployName={showDeployName}
        showRequestParameters={showRequestParameters}
        type={model?.type}
        onFormInstanceReady={onFormReady}
      />
    );
  },
);

export default ModelConfigContent;
