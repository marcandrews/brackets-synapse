/*jslint node: true, vars: true, plusplus: true, devel: true, nomen: true, regexp: true, white: true, indent: 2, maxerr: 50 */
/*global define, $, brackets, Mustache, window, console */
define(function (require, exports, module) {
	"use strict";
	
	// HEADER >>
	var	EventDispatcher	= brackets.getModule("utils/EventDispatcher"),
			FileUtils				= brackets.getModule("file/FileUtils"),
			FileTreeView		= require("modules/FileTreeView"),
			Panel						= require("modules/Panel"),
			PathManager			= require("modules/PathManager"),
			Project					= require("modules/Project"),
			Shared					= require("modules/Shared"),
			_								= require("node/node_modules/lodash/index"),
			Log							= require("modules/Log");

	var _currentServerSetting;

	var init,
			clear,
			connect,
			getListIgnoreExclude,
			getList,
			uploadFile,
			rename,
			download,
			mkdir,
			removeDirectory,
			deleteFile
			;

	var ONLINE = true,
			OFFLINE = false,
			CONNECTION_CHANGED = "CONNECTION_CHAGNED",
			State = {
				_mode: OFFLINE,
				task: "",

				get mode() {
					return this._mode;
				},

				set mode(val) {
					this._mode = val;
					exports.trigger(CONNECTION_CHANGED, this._mode);
				}
			},
			jq = {
				tv : $("#synapse-tree")
			};

	var _convObjectLikeFTP;
	//<<

	init = function () {
		clear();
		return new $.Deferred().resolve().promise();
	};

	
	clear = function () {
		jq.tv.html("");
	};

	getListIgnoreExclude = function (serverSetting, list) {
		if (serverSetting.exclude === undefined || serverSetting.exclude  === "") {
			serverSetting.exclude = "^\.$, ^\.\.$, ^\..+$";
			return list;
		}
		
		function isExclude (ptnAry, filename) {
			var _isExclude = false;
			_.forEach(ptnAry, function (ptn) {
				ptn = ptn.trim();
				ptn = ptn.replace(/\\/g, "\\");
				
				var regexp = new RegExp(ptn);
				
				_isExclude = filename.match(regexp);
				if (_isExclude) return false;
			});
			return _isExclude;
		}

		var ary = serverSetting.exclude.split(",");
		var tmp = [];
		var match;
		if (ary.length > 0) {
			_.forEach(list, function (ent) {
				match = isExclude(ary, ent.name);
				if (!match) {
					tmp.push(ent);
				}
			});
			return tmp;
		} else {
			return list;
		}
	};

	/**
	 * This function will connect to server and get files list from server
	 * and the project open with created entities.
	 * 
	 * @param {object} server setting object.
	 * @return {$.Promise} a promise that will be resolved when opened project, or rejected.
	 */
	connect = function (setting) {
		var method 			= "",
				deferred 		=  new $.Deferred();
		
		Panel.showSpinner();
		
		var remoteRoot = PathManager.getRemoteRoot();
		
		if (setting.protocol === "ftp") {
			method = "connect";
		} else {
			method = "sftpConnect";
		}
		
		Shared.domain.exec(method, setting, remoteRoot)
		.then(function (list) {
			Log.q("Found " + list.length + " files in the directory (" + remoteRoot + ")");
			var d = new $.Deferred();
			if (setting.protocol === "sftp") {
				list = _convObjectLikeFTP(list);
			}
			list = getListIgnoreExclude(setting, list);
			return d.resolve(list).promise();
		}, function (err) {
			Log.q("Failed to connection established.", true, err);
			deferred.reject(err);
		})
		.then(function (list) {
			var d = new $.Deferred();
			FileTreeView.loadTreeView(setting)
			.then(function (rootEntity) {
				d.resolve(list, rootEntity);
			});
			return d.promise();
		})
		.then(function (list, rootEntity) {
			var d = new $.Deferred();
			FileTreeView.setEntities(list, rootEntity)
			.then(function () {
				d.resolve(list);
			}, function (err) {
				Log.q("Error occured when create the entities.", true, err);
				d.reject(err);
			});
			return d.promise();
		})
		.then(function (list) {
			return Project.open(setting);
		}, function (err) {
			deferred.reject(err);
		})
		.then(function () {
			_currentServerSetting = setting;
			State.mode = ONLINE;
			deferred.resolve();
		}, function (err) {
			Log.q("Failed to open the project.", true, err);
			deferred.reject(err);
		})
		.always(function () {
			Panel.hideSpinner();
		});
		return deferred.promise();
	};

	getList = function (entity, setting, remotePath) {
		var deferred = new $.Deferred(),
				method = "";
		
		Panel.showSpinner();
		
		if (setting.protocol === "ftp") {
			method = "getList";
		} else
		if (setting.protocol === "sftp") {
			method = "sftpGetList";
		}
		
		Shared.domain.exec(method, setting, remotePath)
		.then(function (list) {
			if (setting.protocol === "sftp") {
				list = _convObjectLikeFTP(list);
			}
			list = getListIgnoreExclude(setting, list);
			Log.q("Found " + list.length + " files in the directory (" + remotePath + ")");
			deferred.resolve(list);
		}, function (err) {
			err = new Error({err: err, protocol: setting.protocol});
			Log.q("Faild to read the list from the server.", true, err);
			deferred.reject(err);
		}).always(function () {
			Panel.hideSpinner();
		});
		return deferred.promise();
	};

	uploadFile = function (setting, localPath, remotePath) {
		var deferred = new $.Deferred();
		var method = "";
		if (setting.protocol === "ftp") {
			method = "upload";
		} else
		if (setting.protocol === "sftp") {
			method = "sftpUpload";
		}
		var filename = FileUtils.getBaseName(remotePath);
		Panel.showSpinner();
		Shared.domain.exec(method, setting, localPath, remotePath)
		.then(function () {
			Log.q(filename + " have been uploaded successfully.");
			deferred.resolve();
		}, function (err) {
			Log.q(filename + " upload to the server failed.", true, err);
			deferred.reject(err);
		})
		.always(function () {
			Panel.hideSpinner();
		});
		return deferred.promise();
	};

	mkdir = function (setting, remotePath) {
		var deferred =new $.Deferred();
		var method = "";
		if (setting.protocol === "ftp") {
			method = "createDirectory";
		} else
		if (setting.protocol === "sftp") {
			method = "sftpCreateDirectory";
		}
		Shared.domain.exec(method, setting, remotePath)
		.then(function () {
			Log.q("The directory successfully created");
			deferred.resolve(true);
		}, function (err) {
			Log.q("Failed to creat directory to the server", true, err);
			deferred.reject(err);
		});
		return deferred.promise();
	};

	removeDirectory = function (setting, remotePath) {
		var deferred = new $.Deferred();
		var method = "";
		if (setting.protocol === "ftp") {
			method = "removeDirectory";
		} else
		if (setting.protocol === "sftp") {
			method = "sftpRemoveDirectory";
		}
		Shared.domain.exec(method, setting, remotePath)
		.then(function (res) {
			if (res) {
				Log.q("The remote directory successfully deleted");
				deferred.resolve(true);
			} else {
				Log.q("Failed to delete the remote directory", true);
				deferred.resolve(false);
			}
		}, function (err) {
			Log.q("Failed to delete the remote directory.", true, err);
			deferred.reject(err);
		});
		return deferred.promise();
	};

	deleteFile = function (setting, remotePath) {
		var deferred = new $.Deferred();
		var method = "";
		if (setting.protocol === "ftp") {
			method = "removeFile";
		} else {
			method = "sftpRemoveFile";
		}
		Shared.domain.exec(method, setting, remotePath)
		.then(function () {
			Log.q("The remote file successfully deleted.");
			deferred.resolve(true);
		}, function (err) {
			Log.q("Failed to delete the remote file.", true, err);
			deferred.reject(err);
		});
		return deferred.promise();
	};

	rename = function (serverSetting, oldPath, newPath) {
		var deferred = new $.Deferred();
		Shared.domain.exec("Rename", serverSetting, oldPath, newPath)
			.then(function () {
				Log.q("The remote file successfully renamed");
				deferred.resolve(true);
			}, function (err) {
				Log.q("Failed to rename the remote file", true, err);
				deferred.reject(err);
			});
		return deferred.promise();
	};

	download = function (setting, localPath, remotePath) {
		var deferred = new $.Deferred();
		var method = "";
		if (setting.protocol === "ftp") {
			method = "download";
		} else
		if (setting.protocol === "sftp") {
			method = "sftpDownload";
		}
		Shared.domain.exec(method, setting, localPath, remotePath)
			.then(function () {
				Log.q("The file successfully downloaded");
				deferred.resolve(true);
			}, function (err){
				Log.q("Failed to download the remote file", true, err);
				deferred.reject(err);
			});
		return deferred.promise();
	};

	_convObjectLikeFTP = function (ents) {
		var list = [];
		_.forEach(ents, function (ent) {
			var obj = {},
			octMode = ent.attrs.mode.toString(8);
			
			function getTime(ts) {
				var timestamp = ts;
				var date = new Date(timestamp * 1000);
				return date.toISOString();
			}
			function digitToString(digit) {
				var res = "";
				switch (digit) {
					case '7':
						res = "rwx";
						break;
					case '6':
						res = "rw";
						break;
					case '5':
						res = "rx";
						break;
					case '4':
						res = "r";
						break;
					case '3':
						res = "wx";
						break;
					case '2':
						res = "w";
						break;
					case '1':
						res = "x";
						break;
					case '0':
						res = "";
						break;
				}
				return res;
			}

			var rights = {};
			rights.other = digitToString(octMode.substr(-1, 1));
			rights.group = digitToString(octMode.substr(-2, 1));
			rights.user = digitToString(octMode.substr(-3, 1));

			obj.acl = false;
			obj.owner = ent.attrs.uid;
			obj.group = ent.attrs.gid;
			obj.rights = rights;
			obj.name = ent.filename;
			obj.size = ent.attrs.size;
			obj.date = getTime(ent.attrs.mtime);
			obj.sticky = false;
			obj.type = ent.type;
			obj.destType = ent.destType;
			obj.target = ent.target;
			obj.destType = ent.destType;
			list.push(obj);
		});
		return list;
	};

	EventDispatcher.makeEventDispatcher(exports);

	exports.init = init;
	exports.connect = connect;
	exports.getList = getList;
	exports.rename = rename;
	exports.uploadFile = uploadFile;
	exports.mkdir = mkdir;
	exports.download = download;
	exports.removeDirectory = removeDirectory;
	exports.deleteFile = deleteFile;
	exports.getModuleName = function () {
		return module.id;
	};
});
