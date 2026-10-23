/**
 * Files on the ticket. Uploads go straight to object storage with a checksum; every file is scanned for malware
 * and can only be downloaded once it is marked clean. "Restricted" files are for supervisors only.
 */
import { useRef, useState, type FormEvent } from 'react';
import { Alert, Badge, Button, Group, Input, NativeSelect, Paper, SimpleGrid, Stack, Table, Text } from '@mantine/core';
import { IconDownload, IconInfoCircle } from '@tabler/icons-react';
import { useMutation } from '@tanstack/react-query';
import { getAttachmentDownload, uploadAttachment, type Ticket } from '../../../api';
import { EmptyState } from '../../../components/states';
import { formatBytes, formatRelative, humanize } from '../../../lib/format';
import { malwareLook } from '../../../lib/labels';
import { notifyError } from '../../../lib/notify';
import { useSession, useSignedInUser } from '../../../session/session-provider';
import { useTicketMutation } from '../../tickets/use-ticket-queries';

const ACCEPTED = 'application/pdf,image/jpeg,image/png,text/plain';

export function AttachmentsTab({ ticket }: { ticket: Ticket }) {
  const user = useSignedInUser();
  const { can } = useSession();
  const fileInput = useRef<HTMLInputElement>(null);
  const [classification, setClassification] = useState<'confidential' | 'restricted'>('confidential');
  const [result, setResult] = useState('');

  const upload = useTicketMutation(ticket.id, (u, file: File) => uploadAttachment(u, ticket.id, file, classification));
  const download = useMutation({
    mutationFn: (attachmentId: string) => getAttachmentDownload(user, ticket.id, attachmentId),
    // The link is short-lived and opened in a new tab; `noopener` stops that tab controlling this one.
    onSuccess: (link) => (link.downloadUrl ? window.open(link.downloadUrl, '_blank', 'noopener') : notifyError(new Error('Object storage is not configured.')))
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const file = fileInput.current?.files?.[0];
    if (!file) return;
    setResult('');
    upload.mutate(file, {
      onSuccess: (stored) => {
        if (fileInput.current) fileInput.current.value = '';
        setResult(stored.stored ? 'Uploaded. The file stays unavailable until malware scanning completes.' : 'Details recorded. Object storage is not configured, so no file bytes were stored.');
      }
    });
  };
  const files = ticket.attachments ?? [];

  return (
    <Stack gap="lg">
      {files.length === 0 ? <EmptyState title="No attachments" /> : (
        <Table.ScrollContainer minWidth={560}>
          <Table verticalSpacing="sm" className="attachments">
            <Table.Thead><Table.Tr><Table.Th>File</Table.Th><Table.Th>Classification</Table.Th><Table.Th>Size</Table.Th><Table.Th>Scan</Table.Th><Table.Th>Added</Table.Th><Table.Th /></Table.Tr></Table.Thead>
            <Table.Tbody>
              {files.map((f) => {
                const scan = malwareLook(f.malwareStatus);
                return (
                  <Table.Tr key={f.id}>
                    <Table.Td><Text size="sm" fw={500}>{f.filename}</Text></Table.Td>
                    <Table.Td><Text size="sm">{humanize(f.classification)}</Text></Table.Td>
                    <Table.Td><Text size="sm">{formatBytes(f.sizeBytes)}</Text></Table.Td>
                    <Table.Td><Badge size="sm" variant="light" color={scan.color}>{scan.label}</Badge></Table.Td>
                    <Table.Td><Text size="sm">{formatRelative(f.createdAt)}</Text></Table.Td>
                    <Table.Td>{f.malwareStatus === 'clean' && <Button size="compact-xs" variant="light" leftSection={<IconDownload size={12} />} onClick={() => download.mutate(f.id)}>Download</Button>}</Table.Td>
                  </Table.Tr>
                );
              })}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      )}

      {can('workTicket') && (
        <Paper p="md">
          <form onSubmit={submit}>
            <Stack gap="sm">
              <Text fw={600} size="sm">Add a file</Text>
              <SimpleGrid cols={{ base: 1, sm: 2 }}>
                {/* A native file input keeps the label correctly attached (screen readers, automated tests). */}
                {/* Input.Wrapper's `id` becomes the label's htmlFor and the description's id prefix. */}
                <Input.Wrapper label="File" description="PDF, JPEG, PNG or text, up to 25 MB" id="attachment-file">
                  <input id="attachment-file" ref={fileInput} type="file" accept={ACCEPTED} className="file-input" required aria-describedby="attachment-file-description" />
                </Input.Wrapper>
                <NativeSelect label="Classification" value={classification} onChange={(e) => setClassification(e.currentTarget.value as 'confidential' | 'restricted')}
                  data={[{ value: 'confidential', label: 'Confidential' }, ...(can('supervise') ? [{ value: 'restricted', label: 'Restricted (supervisors only)' }] : [])]} />
              </SimpleGrid>
              {result && <Alert variant="light" color="blue" icon={<IconInfoCircle size={16} />} p="xs">{result}</Alert>}
              <Group justify="flex-end"><Button type="submit" loading={upload.isPending}>Upload</Button></Group>
            </Stack>
          </form>
        </Paper>
      )}
    </Stack>
  );
}
