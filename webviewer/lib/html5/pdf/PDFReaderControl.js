(function(exports) {
    "use strict";
    
    // reference the parent ReaderControl
    exports.DesktopReaderControl = exports.ReaderControl;

    exports.ReaderControl = function(options) {
        var me = this;

        me.fireError = function (type, msg, genericMsg) {
            console.warn('Error: ' + msg);
            me.fireEvent('error', [type, msg, genericMsg]);
        };

        this.showFilePicker = options.showFilePicker;
        this.pdfType = options.pdfType;
        this.initWorker();
        this.initProgress();
        
        this.filename = 'downloaded.pdf';

        // code to handle password requests from DocumentViewer
        var passwordDialog;
        var passwordInput;
        var passwordMessage;
        var showTextMessage;
        var finishedPassword;
        var tryingPassword;
        me.getPassword = function(passwordCallback) {
            // only allow a few attempts
            finishedPassword = me.passwordTries >= 3;
            tryingPassword = false;
            if (me.passwordTries === 0) {
                // first try so we create the dialog
                passwordDialog = $('<div>').attr({
                    'id': 'passwordDialog'
                });

                showTextMessage = $('<div style="color:red"></div>').appendTo(passwordDialog);

                passwordMessage = $('<label>').attr({
                    'for': 'passwordInput'
                })
                    .text('Enter the document password:')
                    .appendTo(passwordDialog);

                passwordInput = $('<input>').attr({
                    'type': 'password',
                    'id': 'passwordInput'
                }).keypress(function(e) {
                    if (e.which === 13) {
                        $(this).parent().next().find('#pass_ok_button').click();
                    }
                }).appendTo(passwordDialog);

                passwordDialog.dialog({
                    modal: true,
                    resizable: false,
                    closeOnEscape: false,
                    close: function () {
                        if (!tryingPassword) {
                            me.fireError('EncryptedFileError', "The document requires a valid password.", i18n.t('error.EncryptedUserCancelled'));
                        }
                    },
                    buttons: {
                        'OK': {click: function() {
                                if (!finishedPassword) {
                                    tryingPassword = true;
                                    passwordCallback(passwordInput.val());
                                }
                                $(this).dialog('close');
                            },
                            id: 'pass_ok_button',
                            text: 'OK'
                        },
                        'Cancel': function() {
                            $(this).dialog('close');
                        }
                    }
                });

            } else if (finishedPassword) {
                // attempts have been used
                me.fireError('EncryptedFileError', "The document requires a valid password.", i18n.t('error.EncryptedAttemptsExceeded'));
            } else {
                // allow another request for the password
                passwordInput.val('');
                showTextMessage.text('The Password is incorrect. Please make sure that Caps lock is not on by mistake, and try again.');
                passwordDialog.dialog('open');
            }

            ++(me.passwordTries);
        };

        me.onDocError = function (err) {
            me.fireError('PDFLoadError', err.message, i18n.t('error.PDFLoadError'));
        };

        exports.DesktopReaderControl.call(this, options);
    };

    exports.ReaderControl.prototype = {
        // we are fine with using a larger max zoom (like 1000%) unlike XOD webviewer
        MAX_ZOOM: 10,
        MIN_ZOOM: 0.05,
        // PDF units are 72 points per inch so we need to adjust it to 96 dpi for window.print()
        printFactor: 96/72,
        /**
         * Initialize UI controls.
         * @ignore
         */
        initUI: function() {
            var me = this;

            exports.DesktopReaderControl.prototype.initUI.call(this);

            var downloadButton = $('<span></span>')
                .addClass('glyphicons disk_save')
                .attr({
                    id: 'downloadButton',
                    'data-i18n': '[title]controlbar.download'
                }).i18n();

            var $printParent = $('#printButton').parent();
            $printParent.append(downloadButton);

            if (this.showFilePicker) {
                var $filePicker = $('<label for="input-pdf" class="file-upload glyphicons folder_open"></label>' +
                    '<input id="input-pdf"  accept="application/pdf" type="file" class="input-pdf">')
                    .attr('data-i18n', '[title]controlbar.open')
                    .i18n();
                $printParent.append($filePicker);

                $filePicker.on('change', me.listener.bind(me));
            }
            var inProgress = false;

            $('#downloadButton').on('click', function () {
                var current_document = me.docViewer.getDocument();
                if (inProgress || !current_document) {
                    return;
                }
                inProgress = true;
                downloadButton.removeClass('disk_save');
                downloadButton.addClass('refresh');
                downloadButton.addClass('rotate-icon');

                var annotManager = me.docViewer.getAnnotationManager();
                current_document.getFileData(annotManager, function (data) {
                    inProgress = false;
                    downloadButton.removeClass('glyphicons-refresh');
                    downloadButton.removeClass('rotate-icon');
                    downloadButton.addClass('disk_save');
                    var arr = new Uint8Array(data);
                    var blob = new Blob([arr], {
                        type: 'application/pdf'
                    });
                    saveAs(blob, me.filename);
                });
            });
        },
        
        /**
         * Loads a PDF document into the ReaderControl
         * @param {string} doc a resource URI to the document. The URI may be an http or blob URL.
         * @param loadOptions options to load the document
         * @param loadOptions.filename the filename of the document to load. Used in the export/save PDF feature.
         * @param loadOptions.customHeaders specifies custom HTTP headers in retrieving the resource URI.
         */
        loadDocument: function (doc, options) {
            this.showProgress();
            this.closeDocument();

            /*jshint unused:false */
            var xhr = new XMLHttpRequest();
            var responseType = (doc.indexOf('blob:') === 0 ? 'blob' : 'arraybuffer');
            xhr.open('GET', doc, true);
            // Set the responseType to arraybuffer. "blob" is an option too, rendering manual Blob creation unnecessary, but the support for "blob" is not widespread enough yet
            xhr.responseType = responseType;
            var me = this;
            
            if(options && options.filename){
                me.filename = options.filename;
            }else{
                //me.filename = doc.slice(doc.lastIndexOf('/') + 1, doc.length);
                me.filename = 'download.pdf';
            }
            
            if(options && options.customHeaders){
                //set custom headers
                for (var header in options.customHeaders) {
                    xhr.setRequestHeader(header, options.customHeaders[header]);
                }
            }

            //xhr.setRequestHeader('Authorization', window.parent.app.authorization);
            xhr.addEventListener('load', function(evt) {
                if (this.status === 200) {
                		// we have successfully downloaded the document (or we are about to
                		// read from a local file which is very fast)
                    me.fireEvent('documentLoadingProgress', evt.loaded, evt.loaded);
                    if (this.responseType === 'blob') {
                        var blob = this.response;
                        var reader = new FileReader();
                        reader.onload = function(e) {
                            // load the document into the viewer
                            me.loadAsync(me.docId, new Uint8Array(e.target.result));
                        };
                        reader.readAsArrayBuffer(blob);
                    } else {
                        // load the document into the viewer
                        me.loadAsync(me.docId, new Uint8Array(this.response));
                    }
                }
                else {
                    me.fireEvent('error', ['pdfLoad', evt.currentTarget.statusText, i18n.t('error.load') + ': ' + evt.currentTarget.statusText]);
                }
            }, false);
            xhr.onprogress = function (evt) {
                me.fireEvent('documentLoadingProgress', evt.loaded, evt.total>0?evt.total:0);
            };
            xhr.addEventListener('error', function (evt) {
                me.fireEvent('error', ['pdfLoad', 'Network failure', i18n.t('error.load')]);
            }, false);

            // Send XHR
            xhr.send();
        },

        loadAsync: function (id, buf) {
            var me = this;
            var partRetriever = new exports.CoreControls.PartRetrievers.HttpPartRetriever();
            partRetriever.data = buf;
            var options = {
                type: 'pdf',
                docId: id,
                getPassword: me.getPassword,
                onError: me.onDocError,
                l: this.l,
                worker: this.worker,
                postMessageTransfers: this.postMessageTransfers
            };
            me.docViewer.setRenderBatchSize(2);
            me.docViewer.setViewportRenderMode(true);
            me.passwordTries = 0;
            this.hasBeenClosed = false;
            me.docViewer.loadAsync(partRetriever, options);
            partRetriever.data = null;
        },

        initProgress: function () {
            var $progress = $('<div id="pdf-progress-bar"><div class="progress-text">Initializing...</div><div class="progress-bar"><div style="width:0%">&nbsp;</div><span>&nbsp;</span></div></div>');
            // light blue: #27a8e0
            // dark blue: #21578a
            $('body').append($progress);
            //$progress.find('.progress-text').text("Initializing...");

            var viewerLoadedDeferred = new $.Deferred();
            var documentLoadedDeffered = new $.Deferred();
            var indeterminateDiv = $('<div class="indeterminate"></div>');
            indeterminateDiv.css({ width: 100 + '%' });
            $progress.find('.progress-text').text('Initializing...');
            $progress.find('.progress-bar div').addClass('light-blue').css({ width: 100 + '%' })
            .prepend(indeterminateDiv);

            $(document).on('viewerLoadingProgress', function (e, progress) {
                var failed = $progress.hasClass('document-failed');
                var pro_per = Math.round(progress * 100);
                if (pro_per > 0 && !failed) {
                    $progress.find('.progress-text').text('Initializing viewer: ' + pro_per + '%');
                }
                $progress.find('.progress-bar div').css({ width: pro_per + '%' }).remove('.indeterminate');
                if (progress >= 1 && !failed) {
                    viewerLoadedDeferred.resolve();
                }
            }).on('documentLoadingProgress', function (e, bytesLoaded, bytesTotal) {
                var loaded_percent = -1;
                if (bytesTotal > 0) {
                    loaded_percent = Math.round(bytesLoaded / bytesTotal * 100);
                }


                if (viewerLoadedDeferred.state() !== 'pending') {
                    //viewer is already, so show document progress

                    if (loaded_percent >= 0) {
                        var max_per = Math.max(95, loaded_percent);
                        if (!$progress.hasClass('document-failed')) {
                            $progress.find('.progress-text').text('Loading document: ' + max_per + '%');
                        }
                        $progress.find('.progress-bar div').addClass('light-blue').css({ width: max_per + '%' }).remove(".indeterminate");
                    } else {
                        //loaded is indeterminate
                        var kb_loaded = Math.round(bytesLoaded / 1024);
                        if (!$progress.hasClass('document-failed')) {
                            $progress.find('.progress-text').text('Loading document: ' + kb_loaded + 'KB');
                            $progress.find('.progress-bar div').addClass('light-blue').prepend(indeterminateDiv);
                        }
                    }

                }

                if (bytesLoaded === bytesTotal) {
                    documentLoadedDeffered.resolve();
                }
            });
            $.when(viewerLoadedDeferred, documentLoadedDeffered).done(function () {

            });
            $(document).on('documentLoaded', function () {
                //viewer ready
                if (!$progress.hasClass('document-failed')) {
                    $progress.fadeOut();
                }
            });

            this.onError = function (e, type, msg, userMsg) {
                $progress.find('.progress-text').text(userMsg);
                $progress.addClass('document-failed');
                $progress.show();
            };
            
            $progress.hide();

        },

        showProgress: function () {
            var $progress = $('body').find('#pdf-progress-bar');
            $progress.show();
            // need to make sure that the document failed class has been removed
            // since we are now loading a new document
            $progress.removeClass('document-failed');
            $progress.find('.progress-text').text('Initializing...');
        },

        initWorker: function () {
            var me = this;
            if (this.pdfType === 'pnacl') {
                var pnaclEmbed = $(
                    '<embed name="pnacl_module" ' +
                    'id="pnacl_module" ' +
                    'width=0 height=0 ' +
                    'src="pdf/PDFWorker.nmf" ' +
                    'type="application/x-pnacl" style="position:absolute" />');

                $(document.body).prepend(pnaclEmbed);
                var pnaclWorker = pnaclEmbed[0];
                pnaclWorker.addEventListener('progress', function (event) {
                    if (event.lengthComputable) {
                        me.fireEvent('viewerLoadingProgress', event.loaded / event.total);
                    }
                }, true);
                pnaclWorker.addEventListener('loadend', function (event) {
                    /*jshint unused:false */
                    me.fireEvent('viewerLoadingProgress', 1);
                }, true);
                
                pnaclWorker.addEventListener('crash', function (event) {
                    /*jshint unused:false */
                    me.fireError('PNaClCrashError', event.exitStatus, i18n.t('error.PNaClCrashError'));
                }, true);
                this.postMessageTransfers = false;
                this.worker = pnaclWorker;
                pnaclWorker.addEventListener('error', function(event){
                    me.fireError('PNaClLoadError', event.lastError, i18n.t('error.PNaClLoadError'));
                }, true);

            } else if (this.pdfType === 'ems') {
                // we throttle here to avoid trailing related errors (we only want one popup)
                // this is relevant especially for IE where we always receive two errors
                // and the second error is meaningless
                this.worker = new Worker('pdf/PDFworker.js');
                this.postMessageTransfers = true;
                this.worker.onerror = _.throttle(function (evt) {
                    if (exports.utils.ie) {
                        me.fireError('EmsWorkerError', evt.message, i18n.t('error.EmsWorkerErrorIE'));
                    }
                    else {
                        me.fireError('EmsWorkerError', evt.message, i18n.t('error.EmsWorkerError'));
                    }
                }, 100, { trailing: false });
                // determine when the worker has finished loading
                var detectLoaded = function (evt) {
                    if ('action' in evt.data) {
                        if (evt.data.action === 'workerLoaded') {
                            // the viewer is now loaded so dispatch an event
                            me.fireEvent('viewerLoadingProgress', 1);
                            // we don't need to listen for any more events here
                            me.worker.removeEventListener('message', detectLoaded);
                        }

                    }

                };
                this.worker.addEventListener('message',detectLoaded,false);
                exports.CoreControls.setProgressiveTime(3000);
            }
        },

        listener: function (e) {
            var me = this;
            var files = e.target.files;
            if (files.length === 0) {
                return;
            }
            this.showProgress();
            this.closeDocument();

            var reader = new FileReader();
            reader.onload = function (e) {
                me.fireEvent('documentLoadingProgress', e.loaded, e.loaded);
                // load the document into the viewer
                me.loadAsync(window.readerControl.docId, new Uint8Array(e.target.result));

                // get the filename so we can use it when downloading the file
                var fullPath = document.getElementById('input-pdf').value;
                if (fullPath) {
                    var startIndex = (fullPath.indexOf('\\') >= 0 ? fullPath.lastIndexOf('\\') : fullPath.lastIndexOf('/'));
                    var filename = fullPath.substring(startIndex);
                    if (filename.indexOf('\\') === 0 || filename.indexOf('/') === 0) {
                        me.filename = filename.substring(1);
                    }
                    else {
                        me.filename = filename;
                    }
                }

            };
            reader.onprogress = function (e) {
                if (e.lengthComputable) {
                    me.fireEvent('documentLoadingProgress', e.loaded, e.total > 0 ? e.total : 0);
                }
            };
            reader.readAsArrayBuffer(files[0]);
        }
    };

    

    exports.ReaderControl.prototype = $.extend({}, exports.DesktopReaderControl.prototype, exports.ReaderControl.prototype);
    
})(window);

$('#slider').addClass('hidden-lg');
$('#searchControl').parent().addClass('hidden-md');
$('#control').css('min-width', 680);
$('head').append($('<link rel="stylesheet" type="text/css" />').attr('href', 'pdf/PDFReaderControl.css'));

//# sourceURL=PDFReaderControl.js