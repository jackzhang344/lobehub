import { Checkbox, Input, Select, TextArea } from '@lobehub/ui';
import { Form, type FormInstance, type FormValues, useForm } from '@lobehub/ui/form';
import type { AiModelType, AiProviderModelListItem } from 'model-bank';
import { memo, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import MaxTokenSlider from '@/components/MaxTokenSlider';

import { parseOpenRouterRouting } from '../ModelConfigModal/utils';
import ExtendParamsSelect from './ExtendParamsSelect';
import { CUSTOM_MODEL_TYPES, hasDuplicateModelId } from './utils';

interface ModelConfigFormProps {
  disabled?: boolean;
  existingModelIds?: string[];
  idEditable?: boolean;
  initialValues?: AiProviderModelListItem;
  onFormInstanceReady: (instance: FormInstance) => void;
  showDeployName?: boolean;
  showOpenRouterRouting?: boolean;
  type?: AiModelType;
}

const ModelConfigForm = memo<ModelConfigFormProps>(
  ({
    showDeployName,
    showOpenRouterRouting,
    idEditable = true,
    onFormInstanceReady,
    initialValues,
    disabled,
    existingModelIds = [],
  }) => {
    const { t } = useTranslation('modelProvider');

    const savedRouting = initialValues?.config?.openRouterProvider;
    const formInstance = useForm<FormValues>({
      initialValues: showOpenRouterRouting
        ? {
            ...initialValues,
            openRouterRoutingJson: savedRouting ? JSON.stringify(savedRouting, null, 2) : '',
          }
        : initialValues,
    });

    const modelTypeOptions = useMemo(
      () =>
        CUSTOM_MODEL_TYPES.map((value) => {
          const label = t(`providerModels.item.modelConfig.type.options.${value}`);

          return {
            label: label !== value ? `${label} (${value})` : label,
            value,
          };
        }),
      [t],
    );

    useEffect(() => {
      onFormInstanceReady(formInstance);
    }, [formInstance, onFormInstanceReady]);

    return (
      <div
        onClick={(e) => {
          e.stopPropagation();
        }}
        onKeyDown={(e) => {
          e.stopPropagation();
        }}
      >
        <Form form={formInstance} layout={'vertical'} style={{ marginTop: 16 }}>
          <Form.Field
            required
            extra={t('providerModels.item.modelConfig.id.extra')}
            label={t('providerModels.item.modelConfig.id.title')}
            name={'id'}
            validate={(value?: string) =>
              hasDuplicateModelId(value, existingModelIds)
                ? t('providerModels.item.modelConfig.id.duplicate')
                : undefined
            }
          >
            <Input
              disabled={disabled || !idEditable}
              placeholder={t('providerModels.item.modelConfig.id.placeholder')}
            />
          </Form.Field>
          {showDeployName && (
            <Form.Field
              extra={t('providerModels.item.modelConfig.deployName.extra')}
              label={t('providerModels.item.modelConfig.deployName.title')}
              name={'config.deploymentName'}
            >
              <Input
                disabled={disabled}
                placeholder={t('providerModels.item.modelConfig.deployName.placeholder')}
              />
            </Form.Field>
          )}
          <Form.Field
            label={t('providerModels.item.modelConfig.displayName.title')}
            name={'displayName'}
          >
            <Input
              disabled={disabled}
              placeholder={t('providerModels.item.modelConfig.displayName.placeholder')}
            />
          </Form.Field>
          {showOpenRouterRouting && (
            <Form.Field
              extra={t('providerModels.item.modelConfig.openRouterRouting.extra')}
              label={t('providerModels.item.modelConfig.openRouterRouting.title')}
              name={'openRouterRoutingJson'}
              validate={(value?: string) => {
                try {
                  parseOpenRouterRouting(value);
                  return undefined;
                } catch {
                  return t('providerModels.item.modelConfig.openRouterRouting.invalid');
                }
              }}
            >
              <TextArea
                disabled={disabled}
                maxLength={8192}
                placeholder={'{"sort":"price","zdr":true}'}
                rows={5}
                spellCheck={false}
              />
            </Form.Field>
          )}
          <Form.Field
            extra={t('providerModels.item.modelConfig.tokens.extra')}
            label={t('providerModels.item.modelConfig.tokens.title')}
            name={'contextWindowTokens'}
          >
            <MaxTokenSlider />
          </Form.Field>
          <Form.Field
            extra={t('providerModels.item.modelConfig.extendParams.extra')}
            label={t('providerModels.item.modelConfig.extendParams.title')}
            name={'settings.extendParams'}
          >
            <ExtendParamsSelect />
          </Form.Field>
          <Form.Field
            desc={t('providerModels.item.modelConfig.functionCall.extra')}
            label={t('providerModels.item.modelConfig.functionCall.title')}
            layout={'horizontal'}
            name={'abilities.functionCall'}
          >
            <Checkbox disabled={disabled} />
          </Form.Field>
          <Form.Field
            desc={t('providerModels.item.modelConfig.vision.extra')}
            label={t('providerModels.item.modelConfig.vision.title')}
            layout={'horizontal'}
            name={'abilities.vision'}
          >
            <Checkbox disabled={disabled} />
          </Form.Field>
          <Form.Field
            desc={t('providerModels.item.modelConfig.reasoning.extra')}
            label={t('providerModels.item.modelConfig.reasoning.title')}
            layout={'horizontal'}
            name={'abilities.reasoning'}
          >
            <Checkbox disabled={disabled} />
          </Form.Field>
          <Form.Field
            desc={t('providerModels.item.modelConfig.search.extra')}
            label={t('providerModels.item.modelConfig.search.title')}
            layout={'horizontal'}
            name={'abilities.search'}
          >
            <Checkbox disabled={disabled} />
          </Form.Field>

          <Form.Field
            desc={t('providerModels.item.modelConfig.imageOutput.extra')}
            label={t('providerModels.item.modelConfig.imageOutput.title')}
            layout={'horizontal'}
            name={'abilities.imageOutput'}
          >
            <Checkbox disabled={disabled} />
          </Form.Field>
          <Form.Field
            desc={t('providerModels.item.modelConfig.video.extra')}
            label={t('providerModels.item.modelConfig.video.title')}
            layout={'horizontal'}
            name={'abilities.video'}
          >
            <Checkbox disabled={disabled} />
          </Form.Field>
          <Form.Field
            extra={t('providerModels.item.modelConfig.type.extra')}
            label={t('providerModels.item.modelConfig.type.title')}
            name={'type'}
          >
            <Select
              disabled={disabled}
              options={modelTypeOptions}
              placeholder={t('providerModels.item.modelConfig.type.placeholder')}
            />
          </Form.Field>
          {/*<Form.Item*/}
          {/*  extra={t('providerModels.item.modelConfig.files.extra')}*/}
          {/*  label={t('providerModels.item.modelConfig.files.title')}*/}
          {/*  name={['abilities', 'files']}*/}
          {/*  valuePropName={'checked'}*/}
          {/*>*/}
          {/*  <Checkbox />*/}
          {/*</Form.Item>*/}
        </Form>
      </div>
    );
  },
);
export default ModelConfigForm;
