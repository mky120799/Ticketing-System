/**
 * The secure-link page, opened from a link the bank emailed (…/upload#<token>).
 * No account is needed: the link is the only credential, it expires, it allows a limited number of documents, and
 * it only works for one request. The token sits after "#", which browsers never send to servers or put in logs;
 * the page sends it to the API in a header.
 */
import { useCallback, useEffect, useState } from 'react';
import { Alert, Center, Loader, Paper, Stack, Text, ThemeIcon, Title } from '@mantine/core';
import { IconBuildingBank, IconCircleCheck, IconLock } from '@tabler/icons-react';
import { linkStatus, sendDocumentByLink, type LinkStatus } from './api';
import { DocumentList, DocumentUpload } from './components/documents';

export function UploadPage() {
  const token = window.location.hash.slice(1);
  const [status, setStatus] = useState<LinkStatus | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    try { setStatus(await linkStatus(token)); setError(''); }
    // Any failure gets the same plain message: a broken or expired link should reveal nothing about the request.
    catch (e) { setStatus(null); setError(e instanceof Error ? e.message : 'This link is not valid or has expired.'); }
    finally { setReady(true); }
  }, [token]);
  useEffect(() => { void load(); }, [load]);

  if (!ready) return <Center mih="100vh" component="main"><Loader aria-label="Loading" /></Center>;

  return (
    <Center mih="100vh" p="md" component="main" bg="gray.0">
      <Paper p="xl" maw={560} w="100%" shadow="sm">
        <Stack gap="md">
          <ThemeIcon size={44} radius="md" aria-hidden><IconBuildingBank size={26} /></ThemeIcon>
          <Title order={1} size="h2">Send documents to the bank</Title>
          <div aria-live="polite">
            {notice && <Alert color="green" icon={<IconCircleCheck size={18} />}>{notice}</Alert>}
            {error && <Alert color="red" role="alert">{error}</Alert>}
          </div>
          {status && (
            <>
              <Text fw={600}>Request {status.reference}</Text>
              <Alert variant="light" color="gray" icon={<IconLock size={16} />}>
                This link works until {new Date(status.expiresAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })} and only for this request. You can send {status.remaining} more {status.remaining === 1 ? 'document' : 'documents'}.
              </Alert>
              <Title order={2} size="h4">Documents you have sent</Title>
              <DocumentList documents={status.documents} empty="You have not sent any documents yet." />
              {status.remaining > 0 && (
                <DocumentUpload label="Choose a document" send={(file) => sendDocumentByLink(token, file)}
                  hint="PDF, JPEG, PNG or text files up to 10 MB. Please cover or leave out full card numbers and PINs. The bank will never ask for your PIN or password."
                  onSent={() => { setError(''); setNotice('Thank you. Your document has been sent. We check every document before our staff can open it.'); void load(); }}
                  onError={(e) => { setNotice(''); setError(e instanceof Error ? e.message : 'Something went wrong.'); }} />
              )}
            </>
          )}
        </Stack>
      </Paper>
    </Center>
  );
}
