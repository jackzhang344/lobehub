import { ActionIcon, Button, Flexbox, Input, Select, TextArea } from '@lobehub/ui';
import { Form, type FormInstance, useWatch } from '@lobehub/ui/form';
import { Plus, Trash2 } from 'lucide-react';
import type { ModelRequestParameterType } from 'model-bank/aiModel';
import { useTranslation } from 'react-i18next';

const types = ['string', 'number', 'boolean', 'json'] as const;
const typeOptions = types.map((value) => ({ label: value, value }));
const booleanOptions = ['true', 'false'].map((value) => ({ label: value, value }));
const scope = 'providerModels.item.modelConfig.requestParameters' as const;

interface ParameterRowProps {
  disabled?: boolean;
  form: FormInstance;
  name: string;
  onRemove: () => void;
}

const ParameterRow = ({ disabled, form, name, onRemove }: ParameterRowProps) => {
  const { t } = useTranslation('modelProvider');
  const type = useWatch(form, `${name}.type`) as ModelRequestParameterType | undefined;
  const valueLabel = t(`${scope}.value`);

  return (
    <Flexbox gap={6}>
      <Flexbox horizontal align={'center'} gap={6} wrap={'wrap'}>
        <Flexbox flex={2} style={{ minWidth: 110 }}>
          <Form.Field bare name={`${name}.name`}>
            <Input
              aria-label={t(`${scope}.name`)}
              disabled={disabled}
              placeholder={t(`${scope}.name`)}
            />
          </Form.Field>
        </Flexbox>
        <Flexbox flex={1} style={{ minWidth: 93 }}>
          <Form.Field bare name={`${name}.type`}>
            <Select
              aria-label={t(`${scope}.type`)}
              disabled={disabled}
              options={typeOptions}
              onChange={(next) => {
                const value = next === 'boolean' ? 'false' : next === 'json' ? '{}' : '';
                form.setValue(`${name}.rawValue`, value);
              }}
            />
          </Form.Field>
        </Flexbox>
        {type !== 'json' && (
          <Flexbox flex={2} style={{ minWidth: 90 }}>
            <Form.Field bare name={`${name}.rawValue`}>
              {type === 'boolean' ? (
                <Select aria-label={valueLabel} disabled={disabled} options={booleanOptions} />
              ) : (
                <Input
                  aria-label={valueLabel}
                  disabled={disabled}
                  inputMode={type === 'number' ? 'decimal' : undefined}
                  placeholder={type === 'number' ? '0' : valueLabel}
                />
              )}
            </Form.Field>
          </Flexbox>
        )}
        <ActionIcon
          aria-label={t(`${scope}.remove`)}
          disabled={disabled}
          icon={Trash2}
          title={t(`${scope}.remove`)}
          onClick={onRemove}
        />
      </Flexbox>
      {type === 'json' && (
        <Form.Field bare name={`${name}.rawValue`}>
          <TextArea
            aria-label={valueLabel}
            disabled={disabled}
            placeholder={'{"key":"value"}'}
            rows={3}
            spellCheck={false}
          />
        </Form.Field>
      )}
    </Flexbox>
  );
};

export const RequestParameterFields = ({
  disabled,
  form,
}: {
  disabled?: boolean;
  form: FormInstance;
}) => {
  const { t } = useTranslation('modelProvider');

  return (
    <Form.Field extra={t(`${scope}.help`)} label={t(`${scope}.title`)} layout={'vertical'}>
      <Form.List name={'requestParameterRows'}>
        {({ add, fields, remove }) => (
          <Flexbox gap={8}>
            {fields.map(({ index, key, name }) => (
              <ParameterRow
                disabled={disabled}
                form={form}
                key={key}
                name={name}
                onRemove={() => remove(index)}
              />
            ))}
            <Button
              disabled={disabled}
              icon={Plus}
              type={'dashed'}
              onClick={() => add({ name: '', rawValue: '', type: 'string' })}
            >
              {t(`${scope}.add`)}
            </Button>
          </Flexbox>
        )}
      </Form.List>
    </Form.Field>
  );
};
